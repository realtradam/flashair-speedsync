<script lang="ts">
  import { imageCache } from '../cache';
  import { autoCacheService } from '../cache';
  import { fly } from 'svelte/transition';

  interface CacheStats {
    entries: number;
    fullCount: number;
    thumbCount: number;
    totalBytes: number;
    maxBytes: number;
    idbEntries: number;
    idbBytes: number;
    idbError: string | undefined;
    idbLastWriteError: string | undefined;
    idbWriteErrorCount: number;
  }

  let stats = $state<CacheStats | undefined>(undefined);

  let idbBudgetPct = $derived(
    stats !== undefined && stats.maxBytes > 0
      ? (stats.idbBytes / stats.maxBytes * 100)
      : 0
  );

  let budgetPct = $derived(
    stats !== undefined && stats.maxBytes > 0
      ? (stats.totalBytes / stats.maxBytes * 100)
      : 0
  );

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const val = bytes / Math.pow(k, i);
    return `${val.toFixed(1)} ${sizes[i]}`;
  }

  let downloadSpeed = $state(0);

  async function refresh() {
    try {
      stats = await imageCache.getStats();
    } catch {
      // ignore
    }
    downloadSpeed = autoCacheService.downloadSpeed;
  }

  $effect(() => {
    void refresh();
    const id = setInterval(() => { void refresh(); }, 2000);
    return () => clearInterval(id);
  });
</script>

<div
  class="fixed top-2 left-2 z-50 bg-base-100/95 backdrop-blur-sm rounded-box shadow-lg border border-base-300 p-3 text-xs font-mono max-w-80 pointer-events-auto"
  transition:fly={{ x: -320, duration: 250 }}
>
  <div class="font-bold text-sm mb-2">Cache Debug</div>

  {#if stats !== undefined}
    <div class="space-y-2">
      <!-- Download Speed -->
      <div>
        <span class="font-semibold">DL Speed:</span>
        {#if downloadSpeed > 0}
          <span class="text-info">{formatBytes(downloadSpeed)}/s</span>
        {:else}
          <span class="text-base-content/50">N/A</span>
        {/if}
      </div>

      <!-- Memory Cache -->
      <div>
        <div class="font-semibold text-primary">Memory Cache</div>
        <div>Entries: <span class="text-info">{stats.entries}</span> ({stats.fullCount} full, {stats.thumbCount} thumb)</div>
        <div>Size: <span class="text-info">{formatBytes(stats.totalBytes)}</span> / {formatBytes(stats.maxBytes)}</div>
        <div>
          <progress class="progress progress-primary w-full h-1.5" value={budgetPct} max="100"></progress>
          <span class="text-[10px]" class:text-error={budgetPct > 90} class:text-warning={budgetPct > 70 && budgetPct <= 90}>{budgetPct.toFixed(1)}% of budget</span>
        </div>
      </div>

      <!-- IndexedDB -->
      <div class="border-t border-base-300 pt-2">
        <div class="font-semibold text-secondary">IndexedDB</div>
        {#if stats.idbError !== undefined}
          <div class="text-error">Error: {stats.idbError}</div>
        {:else}
          <div>Entries: <span class="text-info">{stats.idbEntries}</span></div>
          <div>Size: <span class="text-info">{formatBytes(stats.idbBytes)}</span> / {formatBytes(stats.maxBytes)}</div>
          <div>
            <progress class="progress progress-secondary w-full h-1.5" value={idbBudgetPct} max="100"></progress>
            <span class="text-[10px]" class:text-error={idbBudgetPct > 90} class:text-warning={idbBudgetPct > 70 && idbBudgetPct <= 90}>{idbBudgetPct.toFixed(1)}% of budget</span>
          </div>
          {#if stats.idbWriteErrorCount > 0}
            <div class="text-error mt-1">{stats.idbWriteErrorCount} write errors</div>
            {#if stats.idbLastWriteError !== undefined}
              <div class="text-error text-[10px] break-all">{stats.idbLastWriteError}</div>
            {/if}
          {/if}
          <div class="mt-1">
            {#if stats.idbEntries === stats.entries}
              <span class="text-success">In sync with memory</span>
            {:else if stats.idbEntries < stats.entries}
              <span class="text-warning">IDB behind ({stats.entries - stats.idbEntries} pending)</span>
            {:else}
              <span class="text-info">IDB has {stats.idbEntries - stats.entries} extra (pre-loaded)</span>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {:else}
    <div class="text-base-content/50">Loading…</div>
  {/if}
</div>
