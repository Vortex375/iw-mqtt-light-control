import { Service, State } from 'iw-base/lib/registry';
import * as logging from 'iw-base/lib/logging';
import { recordToObservable } from 'iw-base/lib/record-observable';
import { IwDeepstreamClient } from 'iw-base/modules/deepstream-client';
import { Component, Inject, Scoped } from 'iw-ioc';
import { Record } from '@deepstream/client/dist/src/record/record';
import * as mqtt from 'mqtt';
import { assign } from 'lodash';
import { throttleTime } from 'rxjs/operators';

const log = logging.getLogger('LightDevice');

const RESEND_TIMEOUT = 2000; /* retry commands after 2 seconds */
const MAX_RESENDS = 10;

export interface LightDeviceConfig {
  mqttUrl: string;
  mqttDeviceName: string;
  recordName: string;
}

@Component('light-device')
@Scoped()
@Inject([IwDeepstreamClient])
export class LightDevice extends Service {

  private client: mqtt.Client;
  private lightIsRecord: Record;
  private lightSetRecord: Record;
  private lightSetTopic: string;
  private resendTimer: any;
  private resendCounter: number;

  constructor(private ds: IwDeepstreamClient) {
    super('light-device');
  }

  async start(config: LightDeviceConfig) {
    this.setServiceName(config.mqttDeviceName);
    this.setState(State.BUSY);
    await new Promise<void>((resolve, reject) => {
      const lightTopic = `zigbee2mqtt/${config.mqttDeviceName}`;
      this.lightSetTopic = `zigbee2mqtt/${config.mqttDeviceName}/set`;

      this.client = mqtt.connect(config.mqttUrl);
      this.client.on('connect', () => {
        this.client.subscribe(lightTopic, (err) => err ? reject(err) : resolve());
      });
      this.client.on('message', (topic, payload) => {
        if (topic === lightTopic) {
          const payloadString = payload.toString('utf8');
          try {
            const payloadJSON = JSON.parse(payloadString);
            this.handleMessage(payloadJSON);
          } catch (err) {
            log.error({ err, message: payloadString }, 'unable to parse device message');
          }
        }
      });
    });
    this.lightIsRecord = this.ds.getRecord(`${config.recordName}/is`);
    this.lightSetRecord = this.ds.getRecord(`${config.recordName}/set`);
    await this.lightSetRecord.whenReady();

    recordToObservable(this.lightSetRecord)
      .pipe(throttleTime(50, undefined, { leading: false, trailing: true }))
      .subscribe((cmd) => this.handleCommand(cmd));

    this.setState(State.OK);
  }

  async stop() {
    await new Promise<void>((resolve, reject) => {
      this.client.end(undefined, undefined, resolve);
    });
    this.lightIsRecord.discard();
    this.lightSetRecord.discard();
    this.setState(State.INACTIVE);
  }

  private handleMessage(message: any) {
    if (this.resendTimer) {
      /* got acknowledgement from device - cancel resend timer */
      clearTimeout(this.resendTimer);
      this.resendTimer = undefined;
    }
    log.debug(message, `updating light record from device ${this.lightIsRecord.name}`);
    this.lightIsRecord.set(assign({}, message));
    this.setState(State.OK);
  }

  private handleCommand(command: any) {
    this.resendCounter = 0;
    this.setLight(command);
  }

  private setLight(lightState: any) {
    if (lightState.from === 'device') {
      /* avoid feedback loop */
      return;
    }
    this.setState(State.BUSY, 'sending device command');
    log.debug(lightState, `publishing to ${this.lightSetTopic}`);
    /* if state is 'OFF' we must omit the other settings or the controller
     * turns the light immediately back on */
    if (lightState.state === 'OFF') {
      this.client.publish(this.lightSetTopic, JSON.stringify({ state: lightState.state }));
    } else {
      this.client.publish(this.lightSetTopic, JSON.stringify(lightState));
    }
    if (this.resendTimer) {
      clearTimeout(this.resendTimer);
      this.resendTimer = undefined;
    }
    this.resendTimer = setTimeout(this.resendCommand.bind(this), RESEND_TIMEOUT);
  }

  private resendCommand() {
    const lightState = this.lightSetRecord.get();
    this.resendCounter += 1;
    if (this.resendCounter > MAX_RESENDS) {
      log.error(`unable to send command after ${MAX_RESENDS} retries. Giving up.`);
      this.setState(State.PROBLEM, 'unable to communicate with device');
      return;
    } else {
      log.warn(`resending command (retry ${this.resendCounter})...`);
      this.setLight(lightState);
      this.setState(State.BUSY, `resending command (retry ${this.resendCounter})`);
    }
  }
}
