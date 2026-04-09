<script lang="ts">
  import { flashair } from './lib/flashair';
  import type { FlashAirFileEntry } from './lib/flashair';

  let files = $state<FlashAirFileEntry[]>([]);
  let currentDir = $state('/DCIM');
  let loading = $state(false);
  let error = $state<string | undefined>(undefined);
  let isDark = $state(false);

  $effect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'black' : 'cmyk');
  });

  async function loadFiles(dir: string) {
    loading = true;
    error = undefined;
    try {
      currentDir = dir;
      files = await flashair.listFiles(dir);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      files = [];
    } finally {
      loading = false;
    }
  }

  const imageFiles = $derived(
    files.filter((f) => !f.isDirectory && /\.(jpe?g|png|bmp|gif)$/i.test(f.filename)),
  );

  const directories = $derived(files.filter((f) => f.isDirectory));
</script>

<div class="min-h-screen bg-base-200">
  <div class="navbar bg-base-100 shadow-sm">
    <div class="flex-1">
      <span class="text-xl font-bold px-4">SpeedSync</span>
    </div>
    <div class="flex-none gap-2">
      <button class="btn btn-ghost btn-sm" onclick={() => loadFiles(currentDir)}>
        Refresh
      </button>
      <label class="swap swap-rotate btn btn-ghost btn-sm">
        <input type="checkbox" bind:checked={isDark} />
        <!-- sun icon -->
        <svg class="swap-off fill-current w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
          <path d="M5.64,17l-.71.71a1,1,0,0,0,0,1.41,1,1,0,0,0,1.41,0l.71-.71A1,1,0,0,0,5.64,17ZM5,12a1,1,0,0,0-1-1H3a1,1,0,0,0,0,2H4A1,1,0,0,0,5,12Zm7-7a1,1,0,0,0,1-1V3a1,1,0,0,0-2,0V4A1,1,0,0,0,12,5ZM5.64,7.05a1,1,0,0,0,.7.29,1,1,0,0,0,.71-.29,1,1,0,0,0,0-1.41l-.71-.71A1,1,0,0,0,4.93,6.34Zm12,.29a1,1,0,0,0,.7-.29l.71-.71a1,1,0,1,0-1.41-1.41L17,5.64a1,1,0,0,0,0,1.41A1,1,0,0,0,17.66,7.34ZM21,11H20a1,1,0,0,0,0,2h1a1,1,0,0,0,0-2Zm-9,8a1,1,0,0,0-1,1v1a1,1,0,0,0,2,0V20A1,1,0,0,0,12,19ZM18.36,17A1,1,0,0,0,17,18.36l.71.71a1,1,0,0,0,1.41,0,1,1,0,0,0,0-1.41ZM12,6.5A5.5,5.5,0,1,0,17.5,12,5.51,5.51,0,0,0,12,6.5Zm0,9A3.5,3.5,0,1,1,15.5,12,3.5,3.5,0,0,1,12,15.5Z"/>
        </svg>
        <!-- moon icon -->
        <svg class="swap-on fill-current w-5 h-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
          <path d="M21.64,13a1,1,0,0,0-1.05-.14,8.05,8.05,0,0,1-3.37.73A8.15,8.15,0,0,1,9.08,5.49a8.59,8.59,0,0,1,.25-2A1,1,0,0,0,8,2.36,10.14,10.14,0,1,0,22,14.05,1,1,0,0,0,21.64,13Zm-9.5,6.69A8.14,8.14,0,0,1,7.08,5.22v.27A10.15,10.15,0,0,0,17.22,15.63a9.79,9.79,0,0,0,2.1-.22A8.11,8.11,0,0,1,12.14,19.73Z"/>
        </svg>
      </label>
    </div>
  </div>

  <div class="container mx-auto p-4">
    <div class="breadcrumbs text-sm mb-4">
      <ul>
        <li>
          <button class="link" onclick={() => loadFiles('/')}>/</button>
        </li>
        {#each currentDir.split('/').filter(Boolean) as segment, i}
          <li>
            <button
              class="link"
              onclick={() =>
                loadFiles(
                  '/' +
                    currentDir
                      .split('/')
                      .filter(Boolean)
                      .slice(0, i + 1)
                      .join('/'),
                )}
            >
              {segment}
            </button>
          </li>
        {/each}
      </ul>
    </div>

    {#if loading}
      <div class="flex justify-center py-12">
        <span class="loading loading-spinner loading-lg"></span>
      </div>
    {:else if error}
      <div role="alert" class="alert alert-error">
        <span>{error}</span>
        <button class="btn btn-sm" onclick={() => loadFiles(currentDir)}>Retry</button>
      </div>
    {:else if files.length === 0}
      <div class="text-center py-12 text-base-content/60">
        <p>No files found. Connect to the FlashAir WiFi and tap Refresh.</p>
        <button class="btn btn-primary mt-4" onclick={() => loadFiles(currentDir)}>
          Load Files
        </button>
      </div>
    {:else}
      {#if directories.length > 0}
        <div class="mb-4">
          <h3 class="font-semibold mb-2">Folders</h3>
          <div class="flex flex-wrap gap-2">
            {#each directories as dir}
              <button class="btn btn-outline btn-sm" onclick={() => loadFiles(dir.path)}>
                📁 {dir.filename}
              </button>
            {/each}
          </div>
        </div>
      {/if}

      {#if imageFiles.length > 0}
        <h3 class="font-semibold mb-2">Photos ({imageFiles.length})</h3>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
          {#each imageFiles as file (file.path)}
            {@const thumbUrl = flashair.thumbnailUrl(file.path)}
            <div class="card bg-base-100 shadow-sm">
              {#if thumbUrl}
                <figure class="aspect-square overflow-hidden">
                  <img
                    src={thumbUrl}
                    alt={file.filename}
                    class="object-cover w-full h-full"
                    loading="lazy"
                  />
                </figure>
              {:else}
                <figure class="aspect-square bg-base-300 flex items-center justify-center">
                  <span class="text-3xl">🖼️</span>
                </figure>
              {/if}
              <div class="card-body p-2">
                <p class="text-xs truncate">{file.filename}</p>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</div>
