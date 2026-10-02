import { ApplicationConfig, provideZoneChangeDetection, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideStore, type MetaReducer } from '@ngrx/store';
import { provideHttpClient } from '@angular/common/http';
import { provideTransloco } from '@jsverse/transloco';
import { AppTranslocoLoader } from './transloco.loader';
import { releaseReducer } from './state/release.reducer';
import type { ReleaseState } from './state/release.models';

const STORAGE_KEY = 'firmware-release-v2';

/** 状态变化持久化到 localStorage（过期结构版本在 reducer 初始化时丢弃） */
export function persistenceMetaReducer(
  reducer: (state: ReleaseState | undefined, action: { type: string }) => ReleaseState
): (state: ReleaseState | undefined, action: { type: string }) => ReleaseState {
  return (state, action) => {
    const next = reducer(state, action);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 存储不可用时静默降级
    }
    return next;
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter([]),
    provideAnimationsAsync(),
    provideHttpClient(),
    provideStore({ release: releaseReducer }, { metaReducers: [persistenceMetaReducer as unknown as MetaReducer] }),
    provideTransloco({
      config: { availableLangs: ['zh'], defaultLang: 'zh', reRenderOnLangChange: true, prodMode: !isDevMode() },
      loader: AppTranslocoLoader
    })
  ]
};
