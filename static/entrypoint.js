/**
 * @fileoverview Main entrypoint for Santa Tracker. Runs in the prod domain.
 */

import './src/elements/santa-chrome.js';
import './src/elements/santa-countdown.js';
import * as gameloader from './src/elements/santa-gameloader.js';
import './src/elements/santa-sidebar.js';
import './src/elements/santa-error.js';
import './src/elements/santa-interlude.js';
import * as kplay from './src/kplay.js';
import scenes from './src/strings/scenes.js';
import {_msg, join} from './src/magic.js';
import {configureProdRouter, globalClickHandler} from './src/core/router.js';
import {sceneImage} from './src/core/assets.js';
import * as promises from './src/lib/promises.js';


const kplayReady = kplay.prepare();


// TODO(samthor): If this doesn't work, we need a foreground unmute button, as clicking on the
// iframe probably won't trigger it.
//sc.installGestureResume(document.body);


const loaderElement = document.createElement('santa-gameloader');
const interludeElement = document.createElement('santa-interlude');
const chromeElement = document.createElement('santa-chrome');
document.body.append(chromeElement, loaderElement, interludeElement);

const errorElement = document.createElement('santa-error');
loaderElement.append(errorElement);

const sidebar = document.createElement('santa-sidebar');
sidebar.todayHouse = 'boatload';
sidebar.setAttribute('slot', 'sidebar');
chromeElement.append(sidebar);


kplayReady.then((sc) => {
  if (sc.suspended) {
    console.warn('Web Audio API is suspended, requires user interaction to start');
    document.body.addEventListener('click', () => sc.resume(), {once: true});
  }
});


async function preloadSounds(sc, event, port) {
  await sc.preload(event, (done, total) => {
    port.postMessage({done, total});
  });
  port.postMessage(null);
}


/**
 * Handle preload events from the contained scene. Should not effect global state.
 *
 * @param {!PortControl} control
 * @param {!Object<string, string>} data
 */
async function prepare(control, data) {
  if (!control.hasPort) {
    return {};
  }
  const timeout = promises.timeoutRace(10 * 1000);

  const preloads = [];
  const config = {};
outer:
  for (;;) {
    const op = await timeout(control.next());
    if (op === null) {
      break;  // closed or timeout, bail out
    }

    const {type, payload} = op;
    switch (type) {
      case 'error':
        return Promise.reject(payload);

      case 'progress':
        console.debug('got preload', (payload * 100).toFixed(2) + '%');
        continue;

      case 'preload':
        const [preloadType, event, port] = payload;
        if (preloadType !== 'sounds') {
          throw new TypeError(`unsupported preload: ${payload[0]}`);
        }
        // TODO: don't preload sounds if the AudioContext is suspended, queue for later.
        const sc = await kplayReady;
        preloads.push(preloadSounds(sc, event, port));
        continue;

      case 'ready':
        await timeout(Promise.all(preloads));
        Object.assign(config, payload);
        break outer;
    }

    console.warn('got unhandled preload', op);
  }

  return config;
}


loaderElement.addEventListener(gameloader.events.load, (ev) => {
  // Load process is started. This is triggered every time a new call to .load() is made, even if
  // the previous load isn't finished yet. It's suitable for resetting global UI, although there
  // won't be information about the next scene yet.
  interludeElement.show();
  chromeElement.navOpen = false;
  chromeElement.mini = true;
});


loaderElement.addEventListener(gameloader.events.error, (ev) => {
  // TODO(samthor): Internal errors could cause an infinite loop here.
  const {error, context} = ev.detail;
  const {sceneName} = context;
  loaderElement.load(null, {error, sceneName});
});


loaderElement.addEventListener(gameloader.events.prepare, (ev) => {
  // A new frame is being loaded. It's not yet visible (although its onload event has fired by now),
  // but the prior frame is now deprecated and is inevitably going to be removed.
  // It's possible that the new frame is null (missing/404/empty): in this case, control is null.

  const {context, resolve, control, ready} = ev.detail;

  const call = async () => {
    const {data, sceneName, error, locked} = context;

    // Kick off the preload for this scene and wait for the interlude to appear.
    const configPromise = prepare(control, data);
    await interludeElement.show();
    if (!control.isAttached) {
      return false;  // replaced during interlude
    }

    // The interlude is fully visible, so we can purge the old scene (although this is optional as
    // `santa-gameloader` will always do this for us _anyway_).
    loaderElement.purge();

    // Configure optional error state of `santa-error` while the interlude is visible.
    errorElement.code = null;
    if (error) {
      errorElement.code = 'internal';
    } else if (locked) {
      // do nothing
    } else if (!control.hasPort && sceneName) {
      errorElement.code = 'missing';
    }
    errorElement.textContent = '';
    errorElement.lock = locked;
    const lockedImagePromise = locked ? sceneImage(sceneName) : Promise.resolve(null);

    // Wait for preload (and other tasks) to complete. None of these have effect on global state so
    // only check if we're still the active scene once done.
    const config = await configPromise;
    const lockedImage = await lockedImagePromise.catch(null);
    const sc = await kplayReady;

    // Everything is ready, so inform `santa-gameloader` that we're happy to be swapped in if we
    // are still the active scene.
    if (!ready()) {
      return false;
    }

    // Run configuration tasks and remove the interlude.
    if (lockedImage) {
      lockedImage.setAttribute('slot', 'icon');
      errorElement.append(lockedImage);
    }
    interludeElement.removeAttribute('active');
    chromeElement.mini = !config.scroll;
    sc.transitionTo(config.sound || [], 1.0);

    // Main game loop. If op is null, we've been shutdown.
    for (;;) {
      const op = await control.next();
      if (op === null) {
        console.warn('running scene got shutdown');
        break;
      }

      if (op.type === 'error') {
        throw new Error(data.payload);
      }
      console.debug('running scene got', op);
    }

    // TODO: might be trailing events
  };

  resolve(call());
});



let loadedScene = undefined;

const loaderScene = (sceneName, data) => {
  if (sceneName === loadedScene) {
    return false;
  }

  const title = scenes[sceneName] || '';
  if (title) {
    document.title = `${title} · ${_msg`santatracker`}`;
  } else {
    document.title = _msg`santatracker`;
  }

  const locked = ['tracker'].indexOf(sceneName) !== -1;
  const url = locked ? null : join(import.meta.url, 'scenes', (sceneName || 'index') + '/');

  loadedScene = sceneName;

  const context = {sceneName, data, locked};
  loaderElement.load(url, context).then((success) => {
    if (success) {
      console.info('loading done', sceneName, url);
    } else {
      console.warn('loading superceded', sceneName);
    }
  });
};


const {scope, go} = configureProdRouter(loaderScene);
document.body.addEventListener('click', globalClickHandler(scope, go));

