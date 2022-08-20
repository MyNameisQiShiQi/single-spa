/**
 * 开始依据路由来挂载
 */
export { start } from "./start.js";
export { ensureJQuerySupport } from "./jquery-support.js";
export {
  setBootstrapMaxTime,
  setMountMaxTime,
  setUnmountMaxTime,
  setUnloadMaxTime,
} from "./applications/timeouts.js";
export {
  /**
   * 应用注册
   */
  registerApplication,
  /**
   * 应用注销
   */
  unregisterApplication,
  /**
   * 获取已挂载的应用
   */
  getMountedApps,
  /**
   * 获取应用状态
   */
  getAppStatus,
  /**
   * 应用卸载
   */
  unloadApplication,
  checkActivityFunctions,
  getAppNames,
  pathToActiveWhen,
} from "./applications/apps.js";
export { navigateToUrl } from "./navigation/navigation-events.js";
export { triggerAppChange } from "./navigation/reroute.js";
export {
  addErrorHandler,
  removeErrorHandler,
} from "./applications/app-errors.js";
/***
 * parcel的挂载
 */
export { mountRootParcel } from "./parcels/mount-parcel.js";

/**
 * 全部的子应用状态
 */
export {
  NOT_LOADED,
  LOADING_SOURCE_CODE,
  NOT_BOOTSTRAPPED,
  BOOTSTRAPPING,
  NOT_MOUNTED,
  MOUNTING,
  UPDATING,
  LOAD_ERROR,
  MOUNTED,
  UNMOUNTING,
  SKIP_BECAUSE_BROKEN,
} from "./applications/app.helpers.js";

import devtools from "./devtools/devtools";
import { isInBrowser } from "./utils/runtime-environment.js";

if (isInBrowser && window.__SINGLE_SPA_DEVTOOLS__) {
  window.__SINGLE_SPA_DEVTOOLS__.exposedMethods = devtools;
}
