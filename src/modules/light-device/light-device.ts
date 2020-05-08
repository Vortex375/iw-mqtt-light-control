import { Service, State } from 'iw-base/lib/registry';
import * as logging from 'iw-base/lib/logging';
import { IwDeepstreamClient } from 'iw-base/modules/deepstream-client';
import { Record } from '@deepstream/client/dist/record/record';
import * as mqtt from 'mqtt';
import { assign } from 'lodash';

const log = logging.getLogger('LightDevice');

const RESEND_TIMEOUT = 2000; /* retry commands after 2 seconds */
const MAX_RESENDS = 10;

export interface LightDeviceConfig {
  mqttUrl: string;
  mqttDeviceName: string;
  lightRecord: string;
}

export class LightDevice extends Service {

  private client: mqtt.Client;
  private lightRecord: Record;
  private lightSetTopic: string;
  private resendTimer: any;
  private resendCounter: number;

  constructor(private ds: IwDeepstreamClient) {
    super('light-device');
  }

  async start(config: LightDeviceConfig) {
    this.setServiceName(config.mqttDeviceName);
    this.setState(State.BUSY);
    await new Promise((resolve, reject) => {
      const lightTopic = `zigbee2mqtt/${config.mqttDeviceName}`;
      this.lightSetTopic = `zigbee2mqtt/${config.mqttDeviceName}/set`;

      this.client = mqtt.connect(config.mqttUrl);
      this.client.on('connect', () => {
        this.client.subscribe(lightTopic, (err) => err ? reject(err) : resolve());
      });
      this.client.on('message', (topic, payload) => {
        if (topic === lightTopic) {
          const payloadJSON = JSON.parse(payload.toString('utf8'));
          this.handleMessage(payloadJSON);
        }
      });
    });
    this.lightRecord = this.ds.getRecord(config.lightRecord);
    await this.lightRecord.whenReady();
    this.lightRecord.subscribe(undefined, this.handleCommand.bind(this), true);
    this.setState(State.OK);
  }

  async stop() {
    await new Promise((resolve, reject) => {
    this.client.end(undefined, undefined, resolve);
    });
    this.lightRecord.discard();
    this.setState(State.INACTIVE);
  }

  private handleMessage(message: any) {
    if (this.resendTimer) {
      /* got acknowledgement from device - cancel resend timer */
      clearTimeout(this.resendTimer);
      this.resendTimer = undefined;
    }
    log.debug(message, `updating light record ${this.lightRecord.name}`);
    this.lightRecord.set(assign({}, message, { from: 'device' }));
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
    const lightState = this.lightRecord.get();
    if (lightState.from === 'device') {
      /* latest update is from device, so command was acknowledged */
      return;
    }
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
