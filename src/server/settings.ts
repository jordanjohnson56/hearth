// Core settings routes, mounted by the app factory at /api/settings. Each
// setting's value format belongs here, next to the route that reads it.
//
// Contract (status codes):
//   GET /theme   200 { lightFrom, darkFrom } as HH:MM; the defaults until set
//   PUT /theme   200 with the stored values; 400 bad shape, not HH:MM or
//                equal times; 401 no bearer
import type { Database } from 'better-sqlite3';
import { Router } from 'express';
import type { RequestHandler } from 'express';
import { DEFAULT_DARK_FROM, DEFAULT_LIGHT_FROM, isHHMM } from '../core/theme.js';
import type { ThemeTimes } from '../core/theme.js';
import { readSetting, writeSetting } from './db/settingRepository.js';
import { HttpError, bodyOf, jsonBody } from './http.js';

/** The setting keys holding the theme switch times (`HH:MM`, 24-hour). */
export const LIGHT_FROM_SETTING = 'theme.light_from';
export const DARK_FROM_SETTING = 'theme.dark_from';

export interface SettingsRouterOptions {
  db: Database;
  /** The admin's bearer gate; every PUT goes through it. */
  requireAdmin: RequestHandler;
}

export function createSettingsRouter(options: SettingsRouterOptions): Router {
  const { db, requireAdmin } = options;
  const router = Router();
  router.use(jsonBody);

  router.get('/theme', (_req, res) => {
    res.json(readThemeTimes(db));
  });

  router.put('/theme', requireAdmin, (req, res) => {
    const times = themeTimesOf(req.body);
    writeSetting(db, LIGHT_FROM_SETTING, times.lightFrom);
    writeSetting(db, DARK_FROM_SETTING, times.darkFrom);
    res.json(readThemeTimes(db));
  });

  return router;
}

/** The stored switch times, each falling back to its default when unset. */
export function readThemeTimes(db: Database): ThemeTimes {
  return {
    lightFrom: readSetting(db, LIGHT_FROM_SETTING) ?? DEFAULT_LIGHT_FROM,
    darkFrom: readSetting(db, DARK_FROM_SETTING) ?? DEFAULT_DARK_FROM,
  };
}

/** The validated body of a PUT /theme, or a 400 saying which field is wrong. */
function themeTimesOf(body: unknown): ThemeTimes {
  const { lightFrom, darkFrom } = bodyOf(body);
  if (!isHHMM(lightFrom)) throw new HttpError(400, 'Light from must be a time as HH:MM');
  if (!isHHMM(darkFrom)) throw new HttpError(400, 'Dark from must be a time as HH:MM');
  if (lightFrom === darkFrom) throw new HttpError(400, 'Light from and dark from must differ');
  return { lightFrom, darkFrom };
}
