// RI-EDU-2 Stage 4 — module resolution strategy: Route A (no formal
// workspaces), not Route B. See the Stage 4 report for the full
// justification; summary: Route A requires zero change to the root
// ArcFlow package.json/tooling (the Next.js app has no workspaces
// configured today), lives entirely inside app-mobile's own files, and is
// trivially reversible (delete app-mobile/, nothing else in the repo
// changes).
//
// IMPORTANT, empirically verified (see Stage 4 report): plain
// `config.watchFolders` pointing at the external
// lib/adapters/education/core directory (with or without
// `resolver.nodeModulesPaths` / `unstable_enableSymlinks`) did NOT make
// Metro resolve imports into it -- confirmed with a minimal one-level-up
// reproduction before concluding this, not assumed. The mechanism that
// actually works is a Windows directory junction:
//
//   app-mobile/src/education-core  -->  ../../lib/adapters/education/core
//
// created with (no admin rights required on NTFS):
//   New-Item -ItemType Junction -Path app-mobile\src\education-core `
//     -Target ..\lib\adapters\education\core
//
// The junction makes the shared pure core physically appear INSIDE
// app-mobile's own project tree, so Metro treats it as ordinary local
// source -- no cross-root resolution is needed at all. App code imports it
// as a normal relative path: `../education-core/mission-engine`, etc.
//
// `config.watchFolders` below is kept as a defensive fallback for the dev
// server's live-reload watcher (untested here -- only `expo export`, which
// does not run a live watcher, was verified end-to-end for this report).
// The pure core has zero npm dependencies of its own (confirmed in the
// Stage 2 report), so no nodeModulesPaths entry is required for module
// resolution.
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const repoRoot = path.resolve(projectRoot, '..')

const config = getDefaultConfig(projectRoot)
config.watchFolders = [repoRoot]

module.exports = config
