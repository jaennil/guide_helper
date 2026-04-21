import {
  createTrackedRoute,
  updateTrackedRoute,
  type SavedRouteResponse,
} from "../api/routes";
import type { PendingRouteUpload } from "../storage/pendingRouteUploads";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export interface SyncedPendingUpload {
  uploadId: string;
  route: SavedRouteResponse;
}

export interface PendingUploadSyncResult {
  remainingUploads: PendingRouteUpload[];
  syncedRoutes: SyncedPendingUpload[];
  synced: number;
  failed: number;
}

export async function syncPendingRouteUploadsBatch(
  uploads: PendingRouteUpload[],
): Promise<PendingUploadSyncResult> {
  const remainingUploads: PendingRouteUpload[] = [];
  const syncedRoutes: SyncedPendingUpload[] = [];
  let synced = 0;
  let failed = 0;

  for (const upload of uploads) {
    try {
      const serverRouteId = upload.sessionSnapshot?.serverRouteId;
      const route = serverRouteId
        ? await updateTrackedRoute(serverRouteId, {
            name: upload.payload.name,
            points: upload.payload.points,
            category_ids: upload.payload.category_ids,
            seasons: upload.payload.seasons,
            line_color: upload.payload.line_color,
            started_at: upload.payload.started_at,
          })
        : await createTrackedRoute(upload.payload);
      synced += 1;

      syncedRoutes.push({
        uploadId: upload.id,
        route,
      });
    } catch (syncError) {
      failed += 1;
      remainingUploads.push({
        ...upload,
        lastTriedAt: new Date().toISOString(),
        lastError: errorMessage(syncError, "Не удалось синхронизировать маршрут."),
      });
    }
  }

  return {
    remainingUploads,
    syncedRoutes,
    synced,
    failed,
  };
}
