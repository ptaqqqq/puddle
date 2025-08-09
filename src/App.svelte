<script lang="ts">
  import { onMount } from 'svelte';

  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D;
  let ws: WebSocket;

  function wsUrl(path = '/ws') {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.hostname}:3000${path}`;
  }

  function handlePointer(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    ws?.send(JSON.stringify({ x, y }));
    drawLocalDot(x, y, 'blue');
  }

  function drawRemoteDot(x: number, y: number, color = 'red') {
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x * w, y * h, 6, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawLocalDot(x: number, y: number, color = 'blue') {
    const w = canvas.width;
    const h = canvas.height;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x * w, y * h, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  onMount(() => {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    ctx = canvas.getContext('2d')!;

    ws = new WebSocket(wsUrl());
    ws.onmessage = (ev) => {
      try {
        const { x, y } = JSON.parse(ev.data);
        drawRemoteDot(x, y);
      } catch {}
    };

    return () => {
      ws?.close();
    };
  });
</script>

<canvas bind:this={canvas} on:pointermove={handlePointer} style="width:100%;height:80vh;display:block;touch-action:none"></canvas>