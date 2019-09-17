// @flow
import React, { Component } from 'react';
import { Link } from 'react-router-dom';
import request from 'superagent';

import AudioPlayer from './AudioPlayer';
import Workbench from './Workbench';

import type { ToastMsg } from '../Toast';
import Toast from '../Toast';

import '../css/font-awesome-4.7.0.min.css';
import '../css/annotator.css';

// API constants
if (!process.env.REACT_APP_API_URL) throw new Error('REACT_APP_API_URL missing in env');
const API_URL = process.env.REACT_APP_API_URL + '/annotation-task';


type AnnotationTask = {
  annotationTags: Array<string>,
  boundaries: {
    startTime: string,
    endTime: string,
    startFrequency: number,
    endFrequency: number,
  },
  audioUrl: string,
  spectroUrls: any,
};

export type Annotation = {
  id: string,
  annotation: string,
  startTime: number,
  endTime: number,
  startFrequency: number,
  endFrequency: number,
  active: boolean;
};

type AudioAnnotatorProps = {
  match: {
    params: {
      annotation_task_id: number
    },
  },
  app_token: string,
};

type AudioAnnotatorState = {
  error: ?string,
  toastMsg: ?ToastMsg,
  isLoading: boolean,
  isPlaying: boolean,
  stopTime: ?number,
  currentTime: number,
  duration: number,
  frequencyRange: number,
  task: ?AnnotationTask,
  taskStartTime: number,
  annotations: Array<Annotation>,
};

class AudioAnnotator extends Component<AudioAnnotatorProps, AudioAnnotatorState> {
  audioContext: AudioContext;
  audioPlayer: AudioPlayer;

  constructor(props: AudioAnnotatorProps) {
    super(props);

    const now: Date = new Date();

    this.state = {
      error: undefined,
      toastMsg: undefined,
      isLoading: true,
      isPlaying: false,
      stopTime: undefined,
      currentTime: 0,
      duration: 0,
      frequencyRange: 0,
      task: undefined,
      taskStartTime: now.getTime(),
      annotations: [],
    };
  }

  componentDidMount() {
    const taskId: number = this.props.match.params.annotation_task_id;

    // Retrieve current task
    request.get(API_URL + '/' + taskId.toString())
      .set('Authorization', 'Bearer ' + this.props.app_token)
      .then(result => {
        const task: AnnotationTask = result.body.task;

        // Computing duration (in seconds)
        const startDate = new Date(task.boundaries.startTime);
        const endDate = new Date(task.boundaries.endTime)
        const duration: number = (endDate.getTime() - startDate.getTime()) / 1000;
        const frequencyRange: number = task.boundaries.endFrequency - task.boundaries.startFrequency;

        // Finally, setting state
        this.setState({
          task,
          duration,
          frequencyRange,
          isLoading: false,
          error: undefined,
        });
      })
      .catch(err => {
        if (err.status && err.status === 401) {
          // Server returned 401 which means token was revoked
          document.cookie = 'token=;max-age=0';
          window.location.reload();
        } else {
          this.setState({isLoading: false, error: this.buildErrorMessage(err)});
        }
      });
  }

  buildErrorMessage = (err: any) => {
    return 'Status: ' + err.status.toString() +
      ' - Reason: ' + err.message +
      (err.response.body.title ? ` - ${err.response.body.title}` : '') +
      (err.response.body.detail ? ` - ${err.response.body.detail}` : '');
  }

  seekTo = (newTime: number) => {
    this.audioPlayer.audioElement.currentTime = newTime;
    this.updateProgress(newTime);
  }

  playPause = () => {
    if (this.audioPlayer.audioElement.paused) {
      this.play();
    } else {
      this.pause();
    }
  }

  play = (annotation: ?Annotation) => {
    if (annotation) {
      this.audioPlayer.audioElement.currentTime = annotation.startTime;
      this.activateAnnotation(annotation);
    }
    this.audioPlayer.audioElement.play();

    this.setState({
      isPlaying: true,
      stopTime: annotation ? annotation.endTime : undefined,
    });
  }

  pause = () => {
    this.audioPlayer.audioElement.pause();

    this.setState({
      isPlaying: false,
      stopTime: undefined,
    });
  }

  updateProgress = (seconds: number) => {
    if (this.state.stopTime && (seconds > this.state.stopTime)) {
      this.pause();
    } else {
      this.setState({currentTime: seconds});
    }
  }

  saveAnnotation = (annotation: Annotation) => {
    const maxId: ?number = this.state.annotations
      .map(ann => parseInt(ann.id, 10))
      .sort((a, b) => b - a)
      .shift();

    const newAnnotation: Annotation = Object.assign(
      {}, annotation, { id: maxId ? (maxId + 1).toString() : '1' }
    );

    if (this.state.annotations.length === 0) {
      this.setState({
        toastMsg: {msg: 'Select a tag to annotate the box.', lvl: 'primary'},
      });
    }

    this.activateAnnotation(newAnnotation);
  }

  updateAnnotation = (annotation: Annotation) => {
    const annotations: Array<Annotation> = this.state.annotations
      .filter(ann => ann.id !== annotation.id)
      .concat(annotation);

    this.setState({annotations});
  }

  deleteAnnotation = (annotation: Annotation) => {
    const annotations: Array<Annotation> = this.state.annotations
      .filter(ann => ann.id !== annotation.id);

    this.setState({annotations});
  }

  activateAnnotation = (annotation: Annotation) => {
    const activated: Annotation = Object.assign(
      {}, annotation, { active: true }
    );
    const annotations: Array<Annotation> = this.state.annotations
      .filter(ann => ann.id !== activated.id)
      .map(ann => Object.assign({}, ann, { active: false }))
      .concat(activated);

    this.setState({annotations});
  }

  toggleTag = (tag: string) => {
    const activeAnn: ?Annotation = this.state.annotations
      .find(ann => ann.active);

    if (activeAnn) {
      const newTag: string = (activeAnn.annotation === tag) ? '' : tag;
      const newAnnotation: Annotation = Object.assign(
        {}, activeAnn, { annotation: newTag, }
      );
      const annotations: Array<Annotation> = this.state.annotations
        .filter(ann => !ann.active)
        .concat(newAnnotation);

      this.setState({
        annotations,
        toastMsg: undefined,
      });
    }
  }

  checkAnnotations = () => {
    const emptyAnnotations = this.state.annotations
      .filter((ann: Annotation) => ann.annotation.length === 0);

    if (emptyAnnotations.length > 0) {
      this.activateAnnotation(emptyAnnotations.shift());
      this.setState({
        toastMsg: {msg: 'Make sure all your annotations are tagged.', lvl: 'danger'},
      });
    } else {
      this.submitAnnotations();
    }
  }

  submitAnnotations = () => {
    const taskId: number = this.props.match.params.annotation_task_id;

    const cleanAnnotations = this.state.annotations
      .sort((a, b) => a.startTime - b.startTime)
      .map(ann => {
        return {
          id: ann.id,
          start: ann.startTime,
          end: ann.endTime,
          annotation: ann.annotation,
          startFrequency: ann.startFrequency,
          endFrequency: ann.endFrequency,
        };
      });
    const now: Date = new Date();
    const taskStartTime: number = Math.floor(this.state.taskStartTime / 1000);
    const taskEndTime: number = Math.floor(now.getTime() / 1000);

    request.post(API_URL + '/' + taskId.toString() + '/update-results')
      .set('Authorization', 'Bearer ' + this.props.app_token)
      .send({
        annotations: cleanAnnotations,
        task_start_time: taskStartTime,
        task_end_time: taskEndTime,
      })
      .then(result => {
        const nextTask: number = result.body.next_task;
        const campaignId: number = result.body.campaign_id;

        if (nextTask) {
          window.location.href = '/audio-annotator/' + nextTask.toString();
        } else {
          window.location.href = '/annotation_tasks/' + campaignId.toString();
        }
      })
      .catch(err => {
        if (err.status && err.status === 401) {
          // Server returned 401 which means token was revoked
          document.cookie = 'token=;max-age=0';
          window.location.reload();
        } else {
          this.setState({isLoading: false, error: this.buildErrorMessage(err)});
        }
      });
  }

  formatTimestamp = (rawSeconds: number) => {
    const hours: number = Math.floor(rawSeconds / 3600);
    const minutes: number = Math.floor(rawSeconds / 60) % 60;
    const seconds: number = Math.floor(rawSeconds) % 60;
    const ms: number = rawSeconds - seconds;

    return String(hours).padStart(2, '0') + ':'
      + String(minutes).padStart(2, '0') + ':'
      + String(seconds).padStart(2, '0') + '.'
      + ms.toFixed(3).slice(-3);
  }

  render() {
    if (this.state.isLoading) {
      return <p>Loading...</p>;
    } else if (this.state.error) {
      return <p>Error while loading task: <code>{this.state.error}</code></p>
    } else if (!this.state.task) {
      return <p>Unknown error while loading task.</p>
    } else {
      const task: AnnotationTask = this.state.task;
      const playStatusClass = this.state.isPlaying ? "fa-pause-circle" : "fa-play-circle";
      const sortedAnnotations: Array<Annotation> = this.state.annotations
        .sort((a, b) => a.startTime - b.startTime);

      return (
        <div className="annotator container-fluid">
          <div className="row">
            <h1 className="col-sm-6">Ocean Data Explorer</h1>
            <ul className="col-sm-6 annotator-nav">
              <li><Link to={'/annotation-campaigns'} title="Annotation campaign list">
                Campaigns
              </Link></li>
              <li><Link to={'/audio-annotator/legacy/' + this.props.match.params.annotation_task_id}>
                Switch to old annotator
              </Link></li>
            </ul>
          </div>

          <AudioPlayer
            // controls
            listenInterval={10}
            onListen={(seconds) => this.updateProgress(seconds)}
            onLoadedMetadata={() => this.updateProgress(0)}
            preload="auto"
            ref={(element) => { if (element) this.audioPlayer = element; } }
            src={task.audioUrl}
          ></AudioPlayer>

          <div className="row">
            <Workbench
              currentTime={this.state.currentTime}
              duration={this.state.duration}
              startFrequency={task.boundaries.startFrequency}
              frequencyRange={this.state.frequencyRange}
              spectrogramUrl={task.spectroUrls['100%']}
              annotations={this.state.annotations}
              onAnnotationCreated={this.saveAnnotation}
              onAnnotationUpdated={this.updateAnnotation}
              onAnnotationDeleted={this.deleteAnnotation}
              onAnnotationSelected={this.activateAnnotation}
              onAnnotationPlayed={this.play}
              onSeek={this.seekTo}
            >
            </Workbench>
          </div>

          <div className="row controls">
            <p className="col-sm-1">
              <button
                className={`btn-simple btn-play fa ${playStatusClass}`}
                onClick={this.playPause}
              ></button>
            </p>

            <p className="col-sm-4 text-center">
              <button
                className="btn btn-submit"
                onClick={this.checkAnnotations}
                type="button"
              >Submit &amp; load next recording</button>
            </p>
            <div className="col-sm-4">
              <Toast toastMsg={this.state.toastMsg}></Toast>
            </div>
            <p className="col-sm-3 text-right">
              {this.formatTimestamp(this.state.currentTime)}
              &nbsp;/&nbsp;
              {this.formatTimestamp(this.state.duration)}
            </p>
          </div>

          <div className="row">
            <div className="col-sm-6">
              {this.renderActiveAnnotation()}
            </div>
            <div className="col-sm-6">
              <table className="table table-hover">
                <thead>
                  <tr className="text-center table-light">
                    <th colSpan="3">Annotations</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedAnnotations.map(annotation => this.renderListAnnotation(annotation))}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      );
    }
  }

  renderActiveAnnotation = () => {
    const activeAnn: ?Annotation = this.state.annotations.find(ann => ann.active);

    if (activeAnn && this.state.task) {
      const ann: Annotation = activeAnn;
      const task: AnnotationTask = this.state.task;

      const tags = task.annotationTags.map((tag, idx) => (
        <li key={`tag-${idx.toString()}`}>
          <button
            className={`btn ${(ann.annotation === tag) ? 'btn-tag-selected' : 'btn-tag'}`}
            onClick={() => this.toggleTag(tag)}
            type="button"
          >{tag}</button>
        </li>
      ));

      return (
        <div className="card">
          <h6 className="card-header text-center">Selected annotation</h6>
          <div className="card-body d-flex justify-content-between">
            <p className="card-text">
              <i className="fa fa-clock-o"></i>&nbsp;
              {this.formatTimestamp(ann.startTime)}&nbsp;&gt;&nbsp;
              {this.formatTimestamp(ann.endTime)}<br />
              <i className="fa fa-arrow-up"></i>&nbsp;
              {ann.startFrequency.toFixed(2)}&nbsp;&gt;&nbsp;
              {ann.endFrequency.toFixed(2)} Hz
            </p>
            <ul className="card-text annotation-tags">
              {tags}
            </ul>
          </div>
        </div>
      );
    } else {
      return (
        <div className="card">
          <h6 className="card-header text-center">Selected annotation</h6>
          <div className="card-body">
            <p className="card-text text-center">-</p>
          </div>
        </div>
      );
    }
  }

  renderListAnnotation = (annotation: Annotation) => {
    return (
      <tr
        key={`listann-${annotation.id}`}
        onClick={() => this.activateAnnotation(annotation)}
      >
        <td>
          <i className="fa fa-clock-o"></i>&nbsp;
          {this.formatTimestamp(annotation.startTime)}&nbsp;&gt;&nbsp;
          {this.formatTimestamp(annotation.endTime)}
        </td>
        <td>
          <i className="fa fa-arrow-up"></i>&nbsp;
          {annotation.startFrequency.toFixed(2)}&nbsp;&gt;&nbsp;
          {annotation.endFrequency.toFixed(2)} Hz
        </td>
        <td>
          <i className="fa fa-tag"></i>&nbsp;
          {(annotation.annotation !== '') ? annotation.annotation : '-'}
        </td>
      </tr>
    );
  }
}

export default AudioAnnotator;
