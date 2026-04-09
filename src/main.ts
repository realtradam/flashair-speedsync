import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { imageCache } from './lib/cache'

// Prune expired cache entries on startup (fire-and-forget)
void imageCache.pruneExpired();

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
