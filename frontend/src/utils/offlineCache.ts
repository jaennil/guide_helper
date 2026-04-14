import axios from 'axios';
import { jwtDecode } from 'jwt-decode';
import type { Category } from '../api/categories';
import type { UserProfile } from '../api/profile';
import type { ExploreParams, ExploreResponse, ExploreRoute, Route } from '../api/routes';

const DB_NAME = 'guide-helper-offline';
const DB_VERSION = 1;
const CATEGORIES_STORE = 'categories';
const PRIVATE_ROUTE_LISTS_STORE = 'private-route-lists';
const PRIVATE_ROUTES_STORE = 'private-routes';
const SHARED_ROUTES_STORE = 'shared-routes';
const EXPLORE_STORE = 'explore';
const BOOKMARKS_STORE = 'bookmarks';
const PROFILE_CACHE_PREFIX = 'guide-helper:profile:';

type OfflineStoreName =
  | typeof CATEGORIES_STORE
  | typeof PRIVATE_ROUTE_LISTS_STORE
  | typeof PRIVATE_ROUTES_STORE
  | typeof SHARED_ROUTES_STORE
  | typeof EXPLORE_STORE
  | typeof BOOKMARKS_STORE;

interface CacheRecord<T> {
  key: string;
  value: T;
  updatedAt: number;
}

interface JwtClaims {
  sub?: string;
}

function canUseIndexedDb() {
  return typeof window !== 'undefined' && typeof indexedDB !== 'undefined';
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function openOfflineDb(): Promise<IDBDatabase | null> {
  if (!canUseIndexedDb()) {
    return null;
  }

  try {
    return await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        [CATEGORIES_STORE, PRIVATE_ROUTE_LISTS_STORE, PRIVATE_ROUTES_STORE, SHARED_ROUTES_STORE, EXPLORE_STORE, BOOKMARKS_STORE]
          .forEach((storeName) => {
            if (!database.objectStoreNames.contains(storeName)) {
              database.createObjectStore(storeName, { keyPath: 'key' });
            }
          });
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.warn('[offline-cache] failed to open indexedDB:', error);
    return null;
  }
}

function createRecord<T>(key: string, value: T): CacheRecord<T> {
  return {
    key,
    value,
    updatedAt: Date.now(),
  };
}

async function putRecord<T>(storeName: OfflineStoreName, record: CacheRecord<T>) {
  const database = await openOfflineDb();
  if (!database) {
    return;
  }

  try {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(record);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

async function getRecord<T>(storeName: OfflineStoreName, key: string): Promise<CacheRecord<T> | null> {
  const database = await openOfflineDb();
  if (!database) {
    return null;
  }

  try {
    const transaction = database.transaction(storeName, 'readonly');
    const result = await requestToPromise(transaction.objectStore(storeName).get(key));
    await transactionDone(transaction);
    return (result as CacheRecord<T> | undefined) ?? null;
  } finally {
    database.close();
  }
}

async function deleteRecord(storeName: OfflineStoreName, key: string) {
  const database = await openOfflineDb();
  if (!database) {
    return;
  }

  try {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).delete(key);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

async function getAllRecords<T>(storeName: OfflineStoreName): Promise<Array<CacheRecord<T>>> {
  const database = await openOfflineDb();
  if (!database) {
    return [];
  }

  try {
    const transaction = database.transaction(storeName, 'readonly');
    const result = await requestToPromise(transaction.objectStore(storeName).getAll());
    await transactionDone(transaction);
    return result as Array<CacheRecord<T>>;
  } finally {
    database.close();
  }
}

function getCurrentOwnerKey(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const token = localStorage.getItem('access_token');
  if (!token) {
    return null;
  }

  try {
    const claims = jwtDecode<JwtClaims>(token);
    return claims.sub?.trim() || null;
  } catch (error) {
    console.warn('[offline-cache] failed to decode access token:', error);
    return null;
  }
}

function getProfileStorageKey(ownerKey: string) {
  return `${PROFILE_CACHE_PREFIX}${ownerKey}`;
}

function getPrivateRouteStorageKey(ownerKey: string, routeId: string) {
  return `${ownerKey}:${routeId}`;
}

function buildExploreCacheKey(params: ExploreParams = {}) {
  return JSON.stringify({
    search: params.search ?? '',
    category_id: params.category_id ?? '',
    season: params.season ?? '',
    sort: params.sort ?? '',
    limit: params.limit ?? 0,
    offset: params.offset ?? 0,
  });
}

async function putPrivateRouteList(ownerKey: string, routes: Route[]) {
  await putRecord<Route[]>(PRIVATE_ROUTE_LISTS_STORE, createRecord(ownerKey, routes));
}

async function getPrivateRouteList(ownerKey: string) {
  const record = await getRecord<Route[]>(PRIVATE_ROUTE_LISTS_STORE, ownerKey);
  return record?.value ?? null;
}

export async function cacheCategories(categories: Category[]) {
  await putRecord<Category[]>(CATEGORIES_STORE, createRecord('all', categories));
}

export async function getCachedCategories() {
  const record = await getRecord<Category[]>(CATEGORIES_STORE, 'all');
  return record?.value ?? null;
}

export async function cachePrivateRoutes(routes: Route[]) {
  const ownerKey = getCurrentOwnerKey();
  if (!ownerKey) {
    return;
  }

  await Promise.all([
    putPrivateRouteList(ownerKey, routes),
    ...routes.map((route) =>
      putRecord<Route>(PRIVATE_ROUTES_STORE, createRecord(getPrivateRouteStorageKey(ownerKey, route.id), route)),
    ),
  ]);
}

export async function getCachedPrivateRoutes() {
  const ownerKey = getCurrentOwnerKey();
  if (!ownerKey) {
    return null;
  }

  return await getPrivateRouteList(ownerKey);
}

export async function cachePrivateRoute(route: Route) {
  const ownerKey = getCurrentOwnerKey();
  if (!ownerKey) {
    return;
  }

  await putRecord<Route>(PRIVATE_ROUTES_STORE, createRecord(getPrivateRouteStorageKey(ownerKey, route.id), route));

  const existingRoutes = (await getPrivateRouteList(ownerKey)) ?? [];
  const updatedRoutes = existingRoutes.some((item) => item.id === route.id)
    ? existingRoutes.map((item) => (item.id === route.id ? route : item))
    : [route, ...existingRoutes];

  await putPrivateRouteList(ownerKey, updatedRoutes);
}

export async function patchCachedPrivateRoute(routeId: string, patch: Partial<Route>) {
  const ownerKey = getCurrentOwnerKey();
  if (!ownerKey) {
    return;
  }

  const currentRecord = await getRecord<Route>(PRIVATE_ROUTES_STORE, getPrivateRouteStorageKey(ownerKey, routeId));
  if (!currentRecord) {
    return;
  }

  await cachePrivateRoute({
    ...currentRecord.value,
    ...patch,
  });
}

export async function getCachedPrivateRoute(routeId: string) {
  const ownerKey = getCurrentOwnerKey();
  if (!ownerKey) {
    return null;
  }

  const record = await getRecord<Route>(PRIVATE_ROUTES_STORE, getPrivateRouteStorageKey(ownerKey, routeId));
  return record?.value ?? null;
}

export async function removeCachedPrivateRoute(routeId: string) {
  const ownerKey = getCurrentOwnerKey();
  if (!ownerKey) {
    return;
  }

  await deleteRecord(PRIVATE_ROUTES_STORE, getPrivateRouteStorageKey(ownerKey, routeId));

  const existingRoutes = (await getPrivateRouteList(ownerKey)) ?? [];
  const updatedRoutes = existingRoutes.filter((route) => route.id !== routeId);
  await putPrivateRouteList(ownerKey, updatedRoutes);
}

export async function cacheSharedRoute(token: string, route: Route) {
  await putRecord<Route>(SHARED_ROUTES_STORE, createRecord(token, route));
}

export async function getCachedSharedRoute(token: string) {
  const record = await getRecord<Route>(SHARED_ROUTES_STORE, token);
  return record?.value ?? null;
}

export async function cacheExploreResponse(params: ExploreParams, response: ExploreResponse) {
  await putRecord<ExploreResponse>(EXPLORE_STORE, createRecord(buildExploreCacheKey(params), response));
}

export async function getCachedExploreResponse(params: ExploreParams) {
  const record = await getRecord<ExploreResponse>(EXPLORE_STORE, buildExploreCacheKey(params));
  return record?.value ?? null;
}

export async function cacheBookmarks(routes: ExploreRoute[]) {
  const ownerKey = getCurrentOwnerKey();
  if (!ownerKey) {
    return;
  }

  await putRecord<ExploreRoute[]>(BOOKMARKS_STORE, createRecord(ownerKey, routes));
}

export async function getCachedBookmarks() {
  const ownerKey = getCurrentOwnerKey();
  if (!ownerKey) {
    return null;
  }

  const record = await getRecord<ExploreRoute[]>(BOOKMARKS_STORE, ownerKey);
  return record?.value ?? null;
}

export function cacheUserProfile(profile: UserProfile) {
  if (typeof window === 'undefined') {
    return;
  }

  const ownerKey = getCurrentOwnerKey() ?? profile.id;
  localStorage.setItem(getProfileStorageKey(ownerKey), JSON.stringify(profile));
}

export function getCachedUserProfile() {
  if (typeof window === 'undefined') {
    return null;
  }

  const ownerKey = getCurrentOwnerKey();
  if (!ownerKey) {
    return null;
  }

  const rawValue = localStorage.getItem(getProfileStorageKey(ownerKey));
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as UserProfile;
  } catch (error) {
    console.warn('[offline-cache] failed to parse cached profile:', error);
    localStorage.removeItem(getProfileStorageKey(ownerKey));
    return null;
  }
}

export async function clearPrivateOfflineData() {
  const ownerKey = getCurrentOwnerKey();
  if (!ownerKey) {
    return;
  }

  if (typeof window !== 'undefined') {
    localStorage.removeItem(getProfileStorageKey(ownerKey));
  }

  await Promise.all([
    deleteRecord(PRIVATE_ROUTE_LISTS_STORE, ownerKey),
    deleteRecord(BOOKMARKS_STORE, ownerKey),
  ]);

  const privateRouteRecords = await getAllRecords<Route>(PRIVATE_ROUTES_STORE);
  await Promise.all(
    privateRouteRecords
      .filter((record) => record.key.startsWith(`${ownerKey}:`))
      .map((record) => deleteRecord(PRIVATE_ROUTES_STORE, record.key)),
  );
}

export function shouldUseOfflineFallback(error: unknown) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return true;
  }

  return axios.isAxiosError(error) && !error.response;
}
