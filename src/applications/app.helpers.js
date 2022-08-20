import { handleAppError } from "./app-errors.js";

// App statuses
// 未加载
export const NOT_LOADED = "NOT_LOADED";
// 正在加载
export const LOADING_SOURCE_CODE = "LOADING_SOURCE_CODE";
// 未安装
export const NOT_BOOTSTRAPPED = "NOT_BOOTSTRAPPED";
// 安装中
export const BOOTSTRAPPING = "BOOTSTRAPPING";
// 未挂载
export const NOT_MOUNTED = "NOT_MOUNTED";
// 正在挂载中
export const MOUNTING = "MOUNTING";
// 已挂载
export const MOUNTED = "MOUNTED";
// 正在更新
export const UPDATING = "UPDATING";
// 正在卸载
export const UNMOUNTING = "UNMOUNTING";
// 正在移除
export const UNLOADING = "UNLOADING";
// 加载失败
export const LOAD_ERROR = "LOAD_ERROR";
export const SKIP_BECAUSE_BROKEN = "SKIP_BECAUSE_BROKEN";

// 子app是否已经挂载
export function isActive(app) {
  return app.status === MOUNTED;
}

export function shouldBeActive(app) {
  try {
    return app.activeWhen(window.location);
  } catch (err) {
    handleAppError(err, app, SKIP_BECAUSE_BROKEN);
    return false;
  }
}

export function toName(app) {
  return app.name;
}

export function isParcel(appOrParcel) {
  return Boolean(appOrParcel.unmountThisParcel);
}

export function objectType(appOrParcel) {
  return isParcel(appOrParcel) ? "parcel" : "application";
}
