<script lang="ts">
  import { flashair } from './lib/flashair';
  import { pollService } from './lib/flashair';
  import type { FlashAirFileEntry } from './lib/flashair';
  import { imageCache } from './lib/cache';
  import { autoCacheService } from './lib/cache';
  import ImageList from './lib/components/ImageList.svelte';
  import ImagePreview from './lib/components/ImagePreview.svelte';
  import CacheDebug from './lib/components/CacheDebug.svelte';

  let images = $state<FlashAirFileEntry[]>([]);
  let selectedFile = $state<FlashAirFileEntry | undefined>(undefined);
  let loading = $state(false);
  let error = $state<string | undefined>(undefined);
  let isDark = $state(false);
  let showNewImage = $state(false);
  let isAutoCaching = $state(false);
  let cachedCount = $state(0);
  let totalCount = $state(0);
  let newImagePaths = $state(new Set<string>());

  // Wire the auto-cache service to do a poll check between each download.
  // This pauses the interval during auto-caching and uses checkOnce() instead.
  autoCacheService.onBetweenDownloads = async () => {
    await pollService.checkOnce();
  };

  function startAutoCacheWithPollPause(imageList: FlashAirFileEntry[]) {
    pollService.pause();
    autoCacheService.start(imageList);
  }

  $effect(() => {
    const unsubscribe = autoCacheService.subscribe(() => {
      isAutoCaching = autoCacheService.isActive;
      cachedCount = autoCacheService.cachedCount;
      totalCount = autoCacheService.totalCount;

      // When auto-caching finishes, resume the poll interval
      if (!autoCacheService.isActive) {
        pollService.resume();
      }
    });
    isAutoCaching = autoCacheService.isActive;
    cachedCount = autoCacheService.cachedCount;
    totalCount = autoCacheService.totalCount;
    return unsubscribe;
  });

  $effect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'black' : 'cmyk');
  });

  $effect(() => {
    const unsubscribe = pollService.onNewImages((detected) => {
      // Mark new paths for animation
      const freshPaths = new Set(newImagePaths);
      for (const img of detected) {
        freshPaths.add(img.path);
      }
      newImagePaths = freshPaths;

      // Prepend new images (they are already sorted newest-first from listAllImages)
      images = [...detected, ...images];

      // Feed new images into auto-cache service
      autoCacheService.stop();
      startAutoCacheWithPollPause(images);

      // Auto-select the newest if nothing was selected, or if showNewImage is on
      if ((showNewImage || selectedFile === undefined) && images.length > 0) {
        selectedFile = images[0];
      }
    });
    return unsubscribe;
  });

  async function loadAllImages() {
    loading = true;
    error = undefined;
    autoCacheService.stop();
    pollService.stop();
    try {
      images = await flashair.listAllImages('/DCIM');
      if (images.length > 0 && selectedFile === undefined) {
        selectedFile = images[0];
      }
      pollService.start(images);
      if (images.length > 0) {
        startAutoCacheWithPollPause(images);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      images = [];
    } finally {
      loading = false;
    }
  }

  function selectImage(file: FlashAirFileEntry) {
    selectedFile = file;
  }

  function handleAnimationDone(path: string) {
    const updated = new Set(newImagePaths);
    updated.delete(path);
    newImagePaths = updated;
  }

  let showDebug = $state(false);
  let saving = $state(false);

  async function saveToDevice() {
    if (selectedFile === undefined) return;
    saving = true;
    try {
      // Try cache first
      const cached = await imageCache.get('full', selectedFile.path);
      let blob: Blob;
      if (cached !== undefined) {
        blob = cached.blob;
      } else {
        const url = flashair.fileUrl(selectedFile.path);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        blob = await res.blob();
      }
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = selectedFile.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      error = `Save failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      saving = false;
    }
  }

  async function clearAllCache() {
    autoCacheService.stop();
    await imageCache.clear();
    // Restart auto-caching from scratch
    if (images.length > 0) {
      startAutoCacheWithPollPause(images);
    }
  }
</script>

<div class="flex h-screen bg-base-200">
  <!-- Left: Image preview -->
  <div class="flex-1 min-w-0 h-full overflow-hidden">
    {#if loading}
      <div class="flex items-center justify-center h-full">
        <span class="loading loading-spinner loading-lg"></span>
      </div>
    {:else if error}
      <div class="flex items-center justify-center h-full p-4">
        <div role="alert" class="alert alert-error max-w-md">
          <span>{error}</span>
          <button class="btn btn-sm" onclick={() => loadAllImages()}>Retry</button>
        </div>
      </div>
    {:else if images.length === 0}
      <div class="flex items-center justify-center h-full text-base-content/60 p-8">
        <div class="text-center">
          <p>No photos found. Connect to FlashAir WiFi and tap the refresh button.</p>
          <button class="btn btn-primary mt-4" onclick={() => loadAllImages()}>Load Photos</button>
        </div>
      </div>
    {:else}
      <ImagePreview file={selectedFile} />
    {/if}
  </div>

  <!-- Right: Image list -->
<div class="w-36 lg:w-40 shrink-0 border-l border-base-300 flex flex-col">
    <div class="px-3 py-2 bg-base-100 border-b border-base-300 shrink-0 flex items-center gap-1.5 overflow-hidden">
      <span class="text-xs font-semibold whitespace-nowrap truncate">Photos {cachedCount}/{totalCount > 0 ? totalCount : images.length}</span>
      <span class="relative shrink-0 inline-flex">
        {#if isAutoCaching}
          <span class="status status-secondary animate-ping absolute"></span>
        {/if}
        <span class="status {isAutoCaching ? 'status-secondary' : 'status-neutral'}"></span>
      </span>
    </div>
    <div class="flex-1 min-h-0">
      <ImageList {images} selectedPath={selectedFile?.path} onSelect={selectImage} {newImagePaths} onAnimationDone={handleAnimationDone} />
    </div>
  </div>
</div>

<!-- FAB Flower: bottom-right -->
<div class="fab fab-flower">
  <!-- Trigger: hamburger icon (shown when closed) -->
  <div tabindex="0" class="btn btn-lg btn-circle btn-secondary">
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
    </svg>
  </div>
  <!-- Save/Download (center when opened) -->
  <button class="btn btn-lg btn-circle btn-primary" onclick={() => void saveToDevice()} disabled={selectedFile === undefined || saving}>
    {#if saving}
      <span class="loading loading-spinner loading-sm"></span>
    {:else}
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
    {/if}
  </button>
  <!-- Show New Image toggle -->
  <button class="btn btn-lg btn-circle {showNewImage ? 'btn-accent' : 'btn-neutral'}" onclick={() => (showNewImage = !showNewImage)} aria-label="Toggle auto-show new images">
    {#if showNewImage}
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      </svg>
    {:else}
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
      </svg>
    {/if}
  </button>
  <!-- Clear Cache -->
  <button class="btn btn-lg btn-circle btn-warning" onclick={() => void clearAllCache()}>
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" />
    </svg>
  </button>
  <!-- Debug toggle -->
  <button class="btn btn-lg btn-circle btn-info" onclick={() => showDebug = !showDebug}>
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5">
      <path stroke-linecap="round" stroke-linejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
    </svg>
  </button>
  <!-- Dark mode toggle -->
  <button class="btn btn-lg btn-circle btn-secondary" onclick={() => (isDark = !isDark)}>
    {#if isDark}
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
      </svg>
    {:else}
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
      </svg>
    {/if}
  </button>
</div>

{#if showDebug}
  <CacheDebug />
{/if}
