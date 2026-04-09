<script lang="ts">
  import { imageCache } from '../cache';

  interface CacheStats {
    entries: number;
    fullCount: number;
    thumbCount: number;
    totalBytes: number;
    idbEntries: number;
    idbBytes: number;
    idbError: string | undefined;
  }

  let stats = $state<CacheStats | undefined>(undefined);
  let refreshing = $state(false);
  let collapsed = $state(false);

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const val = bytes / Math.pow(k, i);
    return `${val.toFixed(1)} ${sizes[i]}`;
  }

  async function refresh() {
    refreshing = true;
    try {
      stats = await imageCache.getStats();
    } catch { /* ignore */ }
    refreshing = false;
  }

  $effect(() => {
    void refresh();
    const id = setInterval(() => { void refresh(); }, 2000);
    return () => clearInterval(id);
  });
</script>

<div class="fixed top-2 left-2 z-50 bg-base-100/95 backdrop-blur-sm rounded-box shadow-lg border border-base-300 p-3 text-xs font-mono max-w-80 pointer-events-auto">
  <button
    class="flex items-center justify-between w-full mb-1"
    onclick={() => collapsed = !collapsed}
  >
    <span class="font-bold text-sm">Cache Debug</span>
    <span class="text-base-content/50">{collapsed ? '▶' : '▼'}</span>
  </button>

  {#if !collapsed && stats !== undefined}
    <div class="space-y-2">
      <!-- Memory Cache -->
      <div>
        <div class="font-semibold text-primary">Memory Cache</div>
        <div>Entries: <span class="text-info">{stats.entries}</span> ({stats.fullCount} full, {stats.thumbCount} thumb)</div>
        <div>Size: <span class="text-info">{formatBytes(stats.totalBytes)}</span></div>
      </div>

      <!-- IndexedDB -->
      <div class="border-t border-base-300 pt-2">
        <div class="font-semibold text-secondary">IndexedDB</div>
        {#if stats.idbError !== undefined}
          <div class="text-error">Error: {stats.idbError}</div>
        {:else}
          <div>Entries: <span class="text-info">{stats.idbEntries}</span></div>
          <div>Size: <span class="text-info">{formatBytes(stats.idbBytes)}</span></div>
          <div class="mt-1">
            {#if stats.idbEntries === stats.entries}
              <span class="text-success">✅ In sync with memory</span>
            {:else if stats.idbEntries < stats.entries}
              <span class="text-warning">⏳ IDB behind ({stats.entries - stats.idbEntries} pending)</span>
            {:else}
              <span class="text-info">IDB has {stats.idbEntries - stats.entries} extra (pre-loaded)</span>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {:else if !collapsed}
    <div class="text-base-content/50">
      {#if refreshing}Loading…{:else}No data{/if}
    </div>
  {/if}
</div>
