import { IwDeepstreamClient } from 'iw-base/modules/deepstream-client';
import { UdpDiscovery } from 'iw-base/modules/udp-discovery';
import { TradfriRemote, TradfriRemoteConfig } from './modules/tradfri-remote';
import { LightDeviceConfig, LightDevice } from './modules/light-device';
import onecolor = require('onecolor');
import { PaulmannRemoteConfig, PaulmannRemote } from './modules/paulmann-remote/paulmann-remote';
import { clamp } from './util/clamp';

const TRADFRI_REMOTE_CONFIG: TradfriRemoteConfig = {
  mqttDeviceName: 'Tradfri Remote 1',
  mqttUrl: 'mqtt://helios4.local',
  lightDevices: [
    {
      recordName: 'light-control/devices/TV Light/set',
      brightnessConfig: {
        prop: 'brightness',
        steps: 255
      },
      onState: {
        state: 'ON'
      },
      offState: {
        state: 'OFF'
      },
      transitionState: {
        transition: 0.2
      },
      noTransitionState: {
        transition: 0
      },
      resetTemplate: { color_temp: undefined, color_temp_percent: undefined, color: undefined },
      templates: [
        { color_temp_percent: 100 },
        { color_temp_percent: 50 },
        { color_temp_percent: 0 },
        { color: { r: 255, g: 147, b:  41 } }, /* candle */
        { color: { r: 255, g: 179, b: 102 } }, /* candle 2 */
        { color: { r: 255, g: 117, b: 107 } }, /* aprikose */
        { color: { h:  42, s: 100 } },         /* orange */
        { color: { h:  52, s: 100 } },         /* yellow */
        { color: { r:  97, g: 255, b: 121 } }, /* gloom */
        { color: { r: 191, g: 102, b: 255 } }, /* flieder */
        { color: { h: 220, s:  18 } }          /* blue sky */
      ]
    },
    {
      recordName: 'light-control/devices/Living Room',
      brightnessConfig: {
        prop: 'brightness',
        steps: 1
      },
      onState: {
        brightness: 1
      },
      offState: {
        brightness: 0
      },
      transitionState: {
        fade: true
      },
      noTransitionState: {
        fade: false
      },
      resetTemplate: {
        correction: { r: 255, g: 224, b: 140 },
        value: undefined,
        from: undefined,
        to: undefined,
        pattern: undefined,
        size: undefined,
        saturation: undefined,
        speed: undefined,
        fps: undefined
       },
      templates: [
        { value: { r: 255, g: 134, b:  41, w:   0 } }, /* candle 3 */
        { value: { r: 255, g: 134, b:  41, w:  50 } }, /* candle 3 with white */
        { value: { r: 255, g: 134, b:  41, w: 255 } }, /* candle 3 with white */
        { value: { r: 255, g: 147, b:  41, w:   0 } }, /* candle */
        { value: { r: 255, g: 117, b: 107, w:   0 } }, /* aprikose */
        { value: { r: 255, g: 216, b:  77, w:   0 } }, /* lemon */
        { value: { r:  97, g: 255, b: 121, w:   0 } }, /* gloom */
        { value: { r: 108, g: 148, b: 122, w:   0 } }, /* green/gray */
        { value: { r: 191, g: 102, b: 255, w:   0 } }, /* flieder */
        { value: { r:  64, g: 156, b: 255, w:   0 } }, /* blue sky */
        { pattern: 'RAINBOW', size: 120, brightness: 1, saturation: 1, speed: 32, fps: 60 },
        { pattern: 'LINEAR_GRADIENT', size: 240, from: { r: 255, g: 0, b: 0, w: 0 }, to: { r: 0, g: 255, b: 0, w: 0 }, correction: undefined },
        { pattern: 'LINEAR_GRADIENT', size: 240, from: { r: 255, g: 80, b: 21, w: 0 }, to: { r: 255, g: 90, b: 0, w: 0 }, correction: undefined }
      ]
    }
  ]
};

const PAULMANN_REMOTE_CONFIG: PaulmannRemoteConfig = {
  mqttDeviceName: 'Paulmann Remote 1',
  mqttUrl: 'mqtt://helios4.local',
  lightDevices: [
    {
      recordName: 'light-control/devices/TV Light',
      setOnOff: (state: any, on: boolean) => {
        if (on) {
          state.state = 'ON';
          state.brightness = undefined;
        } else {
          state.state = 'OFF';
          state.brightness = undefined;
        }
        state.from = 'control';
        return state;
      },
      incrementBrightness: (state: any) => {
        if (state.brightness === undefined) {
          state.brightness = 255;
        } else {
          state.brightness += 20;
        }
        state.brightness = clamp(state.brightness, 0, 255);
        if (state.brightness > 50) {
          state.transition = 0.2;
        }
        state.from = 'control';
        return state;
      },
      decrementBrightness: (state: any) => {
        if (state.brightness === undefined) {
          state.brightness = 255;
        } else {
          state.brightness -= 20;
        }
        state.brightness = clamp(state.brightness, 0, 255);
        if (state.brightness > 50) {
          state.transition = 0.2;
        }
        state.from = 'control';
        return state;
      },
      setBrightnessPercent: (state: any, brightness: number) => {
        state.brightness = 255 * brightness;
        state.from = 'control';
        return state;
      },
      setColorTempPercent: (state: any, colorTemp: number) => {
        state.color_temp_percent = 100 * colorTemp;
        state.color_temp = undefined;
        state.color = undefined;
        state.from = 'control';
        return state;
      },
      setHue: (state: any, hue: number) => {
        state.color_temp = undefined;
        state.color = {
          h: hue,
          s: state.color?.s ?? 100,
          v: 100
        };
        state.from = 'control';
        return state;
      },
      setSaturation: (state: any, saturation: number) => {
        state.color_temp = undefined;
        state.color = {
          h: state.color?.h ?? 0,
          s: saturation * 100,
          v: 100
        };
        state.from = 'control';
        return state;
      }
    },
    {
      recordName: 'light-control/devices/Living Room',
      setOnOff: (state: any, on: boolean) => {
        if (on) {
          state.brightness = 1;
        } else {
          state.brightness = 0;
        }
        state.fade = on;
        return state;
      },
      incrementBrightness: (state: any) => {
        if (state.brightness === undefined) {
          state.brightness = 1;
        } else {
          state.brightness += 0.05;
        }
        state.brightness = clamp(state.brightness, 0, 1);
        state.fade = false;
        return state;
      },
      decrementBrightness: (state: any) => {
        if (state.brightness === undefined) {
          state.brightness = 1;
        } else {
          state.brightness -= 0.05;
        }
        state.brightness = clamp(state.brightness, 0, 1);
        state.fade = false;
        return state;
      },
      setBrightnessPercent: (state: any, brightness: number) => {
        state.brightness = brightness;
        return state;
      },
      setColorTempPercent: (state: any, colorTemp: number) => {
        state.value = {
          r: 255,
          g: 134,
          b: 41,
          w: 255 * (1 - colorTemp)
        },
        state.correction = {
          r: 255,
          g: 224,
          b: 140
        };
        state.pattern = undefined;
        state.fade = false;
        return state;
      },
      setHue: (state: any, hue: number) => {
        let baseColor;
        if (state.value) {
          baseColor = onecolor([state.value.r, state.value.g, state.value.b, 255]);
        } else {
          baseColor = onecolor([ 'HSV', 0, 1, 1, 1 ]);
        }
        const color = baseColor.hue(hue / 360).value(1);
        state.value = {
          r: color.red() * 255,
          g: color.green() * 255,
          b: color.blue() * 255,
          w: 0
        },
        state.correction = {
          r: 255,
          g: 224,
          b: 140
        };
        state.pattern = undefined;
        state.fade = false;
        return state;
      },
      setSaturation: (state: any, saturation: number) => {
        let baseColor;
        if (state.value) {
          baseColor = onecolor([state.value.r, state.value.g, state.value.b, 255]);
        } else {
          baseColor = onecolor([ 'HSV', 0, 1, 1, 1 ]);
        }
        const color = baseColor.saturation(saturation).value(1);
        state.value = {
          r: color.red() * 255,
          g: color.green() * 255,
          b: color.blue() * 255,
          w: 0
        },
        state.correction = {
          r: 255,
          g: 224,
          b: 140
        };
        state.pattern = undefined;
        state.fade = false;
        return state;
      }
    }
  ]
};

const LIGHT_CONFIG: LightDeviceConfig = {
  recordName: 'light-control/devices/TV Light',
  mqttDeviceName: 'TV Light',
  mqttUrl: 'mqtt://helios4.local'
};

const client = new IwDeepstreamClient();
const discovery = new UdpDiscovery(client);
const tradfriRemote = new TradfriRemote(client);
const paulmannRemote = new PaulmannRemote(client);
const lightDevice = new LightDevice(client);
discovery.start({ requestPort: 6031 });

client.on('connected', () => {
  tradfriRemote.start(TRADFRI_REMOTE_CONFIG);
  paulmannRemote.start(PAULMANN_REMOTE_CONFIG);
  lightDevice.start(LIGHT_CONFIG);
});
