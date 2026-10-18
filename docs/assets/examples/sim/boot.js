// Starts a Node mod in a worker for the docs' example previews. The worker's name is
// the mod's URL. The rednode stand-in loads first, so the mod's console and process
// are in place before its first line runs.
import('./worker.js')
  .then(() => import(self.name))
  .then(
    () => postMessage({ t: 'loaded' }),
    (err) => {
      if (String(err?.message).startsWith('process.')) return; // exit or kill while loading
      postMessage({ t: 'crash', error: err?.stack || String(err) });
    },
  );
