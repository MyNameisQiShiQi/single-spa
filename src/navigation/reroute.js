import CustomEvent from "custom-event";
import { isStarted } from "../start.js";
import { toLoadPromise } from "../lifecycles/load.js";
import { toBootstrapPromise } from "../lifecycles/bootstrap.js";
import { toMountPromise } from "../lifecycles/mount.js";
import { toUnmountPromise } from "../lifecycles/unmount.js";
import {
  getAppStatus,
  getAppChanges,
  getMountedApps,
} from "../applications/apps.js";
import {
  callCapturedEventListeners,
  navigateToUrl,
} from "./navigation-events.js";
import { toUnloadPromise } from "../lifecycles/unload.js";
import {
  toName,
  shouldBeActive,
  NOT_MOUNTED,
  MOUNTED,
  NOT_LOADED,
  SKIP_BECAUSE_BROKEN,
} from "../applications/app.helpers.js";
import { assign } from "../utils/assign.js";
import { isInBrowser } from "../utils/runtime-environment.js";

let appChangeUnderway = false,
  peopleWaitingOnAppChange = [],
  currentUrl = isInBrowser && window.location.href;

export function triggerAppChange() {
  // Call reroute with no arguments, intentionally
  return reroute();
}

// load：当应用匹配路由时就会加载脚本（非函数，只是一种状态）。
// bootstrap：应用内容首次挂载到页面前调用。
// Mount：当主应用判定需要激活这个子应用时会调用, 实现子应用的挂载、页面渲染等逻辑。
// unmount：当主应用判定需要卸载这个子应用时会调用, 实现组件卸载、清理事件监听等逻辑。
// unload：非必要函数，一般不使用。unload之后会重新启动bootstrap流程。

/**
 * 核心函数，当加载app，start或者路由变更都会执行此函数
 */
export function reroute(pendingPromises = [], eventArguments) {
  if (appChangeUnderway) {
    return new Promise((resolve, reject) => {
      peopleWaitingOnAppChange.push({
        resolve,
        reject,
        eventArguments,
      });
    });
  }

  // 每次路由前都先获取不同状态下的子应用
  const {
    appsToUnload,
    appsToUnmount,
    appsToLoad,
    appsToMount,
  } = getAppChanges();
  let appsThatChanged,
    navigationIsCanceled = false,
    oldUrl = currentUrl,
    newUrl = (currentUrl = window.location.href);

  // 执行start方法的时候就先置为true，然后执行performAppChanges
  if (isStarted()) {
    appChangeUnderway = true;
    appsThatChanged = appsToUnload.concat(
      appsToLoad,
      appsToUnmount,
      appsToMount
    );
    // 执行子应用变更
    return performAppChanges();
  } else {
    // 首次加载，未start之前都是loadApps，等将想要的子app都load完之后，可以执行start方法
    appsThatChanged = appsToLoad;
    return loadApps();
  }

  function cancelNavigation() {
    navigationIsCanceled = true;
  }

  // registerApplication({
  //   name: 'app1',
  //   app: () => import('src/app1/main.js'),
  //   activeWhen: '/app1',
  //   customProps: {
  //     some: 'value',
  //   }
  // );
  

  /**
   * 首次加载应用，其实就是执行上述对象的app函数
   */
  function loadApps() {
    return Promise.resolve().then(() => {
      const loadPromises = appsToLoad.map(toLoadPromise);

      return (
        // 并发调用返回的 Promise.resolve().then(), 调用loadApp, 返回 
        // Promise.then(val) val => { bootstrap: async () => {}, mount: async () => {}, ... 
        Promise.all(loadPromises)
          .then(callAllEventListeners)
          // there are no mounted apps, before start() is called, so we always return []
          .then(() => [])
          .catch((err) => {
            callAllEventListeners();
            throw err;
          })
      );
    });
  }

  /**
   * 执行子应用切换
   */
  function performAppChanges() {
    return Promise.resolve().then(() => {
      // https://github.com/single-spa/single-spa/issues/545
      /**
       * 生命周期事情emit
       */
      window.dispatchEvent(
        new CustomEvent(
          appsThatChanged.length === 0
            ? "single-spa:before-no-app-change"
            : "single-spa:before-app-change",
          getCustomEventDetail(true)
        )
      );

      /**
       * 生命周期事件emit
       */
      window.dispatchEvent(
        new CustomEvent(
          "single-spa:before-routing-event",
          getCustomEventDetail(true, { cancelNavigation })
        )
      );

      if (navigationIsCanceled) {
        window.dispatchEvent(
          new CustomEvent(
            "single-spa:before-mount-routing-event",
            getCustomEventDetail(true)
          )
        );
        finishUpAndReturn();
        navigateToUrl(oldUrl);
        return;
      }

      const unloadPromises = appsToUnload.map(toUnloadPromise);

      const unmountUnloadPromises = appsToUnmount
        .map(toUnmountPromise)
        .map((unmountPromise) => unmountPromise.then(toUnloadPromise));

      const allUnmountPromises = unmountUnloadPromises.concat(unloadPromises);

      const unmountAllPromise = Promise.all(allUnmountPromises);

      unmountAllPromise.then(() => {
        window.dispatchEvent(
          new CustomEvent(
            "single-spa:before-mount-routing-event",
            getCustomEventDetail(true)
          )
        );
      });

      /* We load and bootstrap apps while other apps are unmounting, but we
       * wait to mount the app until all apps are finishing unmounting
       */
      const loadThenMountPromises = appsToLoad.map((app) => {
        return toLoadPromise(app).then((app) =>
          // 全部的已经load的app去mount
          tryToBootstrapAndMount(app, unmountAllPromise)
        );
      });

      /* These are the apps that are already bootstrapped and just need
       * to be mounted. They each wait for all unmounting apps to finish up
       * before they mount.
       */
      const mountPromises = appsToMount
        .filter((appToMount) => appsToLoad.indexOf(appToMount) < 0)
        .map((appToMount) => {
          return tryToBootstrapAndMount(appToMount, unmountAllPromise);
        });
      return unmountAllPromise
        .catch((err) => {
          callAllEventListeners();
          throw err;
        })
        .then(() => {
          /* Now that the apps that needed to be unmounted are unmounted, their DOM navigation
           * events (like hashchange or popstate) should have been cleaned up. So it's safe
           * to let the remaining captured event listeners to handle about the DOM event.
           */
          callAllEventListeners();

          return Promise.all(loadThenMountPromises.concat(mountPromises))
            .catch((err) => {
              pendingPromises.forEach((promise) => promise.reject(err));
              throw err;
            })
            .then(finishUpAndReturn);
        });
    });
  }

  /**
   * 结束并返回已挂载的app
   */
  function finishUpAndReturn() {
    const returnValue = getMountedApps();
    pendingPromises.forEach((promise) => promise.resolve(returnValue));

    try {
      const appChangeEventName =
        appsThatChanged.length === 0
          ? "single-spa:no-app-change"
          : "single-spa:app-change";
      window.dispatchEvent(
        new CustomEvent(appChangeEventName, getCustomEventDetail())
      );
      window.dispatchEvent(
        new CustomEvent("single-spa:routing-event", getCustomEventDetail())
      );
    } catch (err) {
      /* We use a setTimeout because if someone else's event handler throws an error, single-spa
       * needs to carry on. If a listener to the event throws an error, it's their own fault, not
       * single-spa's.
       */
      setTimeout(() => {
        throw err;
      });
    }

    /* Setting this allows for subsequent calls to reroute() to actually perform
     * a reroute instead of just getting queued behind the current reroute call.
     * We want to do this after the mounting/unmounting is done but before we
     * resolve the promise for the `reroute` function.
     */
    appChangeUnderway = false;

    if (peopleWaitingOnAppChange.length > 0) {
      /* While we were rerouting, someone else triggered another reroute that got queued.
       * So we need reroute again.
       */
      const nextPendingPromises = peopleWaitingOnAppChange;
      peopleWaitingOnAppChange = [];
      reroute(nextPendingPromises);
    }

    return returnValue;
  }

  /* We need to call all event listeners that have been delayed because they were
   * waiting on single-spa. This includes haschange and popstate events for both
   * the current run of performAppChanges(), but also all of the queued event listeners.
   * We want to call the listeners in the same order as if they had not been delayed by
   * single-spa, which means queued ones first and then the most recent one.
   */
  function callAllEventListeners() {
    pendingPromises.forEach((pendingPromise) => {
      callCapturedEventListeners(pendingPromise.eventArguments);
    });

    callCapturedEventListeners(eventArguments);
  }

  function getCustomEventDetail(isBeforeChanges = false, extraProperties) {
    const newAppStatuses = {};
    const appsByNewStatus = {
      // for apps that were mounted
      [MOUNTED]: [],
      // for apps that were unmounted
      [NOT_MOUNTED]: [],
      // apps that were forcibly unloaded
      [NOT_LOADED]: [],
      // apps that attempted to do something but are broken now
      [SKIP_BECAUSE_BROKEN]: [],
    };

    if (isBeforeChanges) {
      appsToLoad.concat(appsToMount).forEach((app, index) => {
        addApp(app, MOUNTED);
      });
      appsToUnload.forEach((app) => {
        addApp(app, NOT_LOADED);
      });
      appsToUnmount.forEach((app) => {
        addApp(app, NOT_MOUNTED);
      });
    } else {
      appsThatChanged.forEach((app) => {
        addApp(app);
      });
    }

    const result = {
      detail: {
        newAppStatuses,
        appsByNewStatus,
        totalAppChanges: appsThatChanged.length,
        originalEvent: eventArguments?.[0],
        oldUrl,
        newUrl,
        navigationIsCanceled,
      },
    };

    if (extraProperties) {
      assign(result.detail, extraProperties);
    }

    return result;

    function addApp(app, status) {
      const appName = toName(app);
      status = status || getAppStatus(appName);
      newAppStatuses[appName] = status;
      const statusArr = (appsByNewStatus[status] =
        appsByNewStatus[status] || []);
      statusArr.push(appName);
    }
  }
}

/**
 * Let's imagine that some kind of delay occurred during application loading.
 * The user without waiting for the application to load switched to another route,
 * this means that we shouldn't bootstrap and mount that application, thus we check
 * twice if that application should be active before bootstrapping and mounting.
 * https://github.com/single-spa/single-spa/issues/524
 */
/**
 * 先bootstrap（安装），再mount（挂载）
 */
function tryToBootstrapAndMount(app, unmountAllPromise) {
  if (shouldBeActive(app)) {
    return toBootstrapPromise(app).then((app) =>
      unmountAllPromise.then(() =>
        shouldBeActive(app) ? toMountPromise(app) : app
      )
    );
  } else {
    return unmountAllPromise.then(() => app);
  }
}
