<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  const uuid = crypto.randomUUID(); 

  let blobCoordinates = $state([{ "uuid": "void", "coordinates": [-2.5, -2.5] }]);

  function pushBlob(id: string, blob: [number, number]) {
    blobCoordinates = blobCoordinates.filter(entry => entry.uuid !== id);
    blobCoordinates.push({ "uuid": id, "coordinates": blob });
    // setTimeout(() => {
      // delete blobCoordinates[uuid];
    // }, 100);
  }

  let ws: WebSocket;

  function wsUrl(path = '/ws') {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.hostname}:3000${path}`;
  }

  function handlePointer(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = 1 - (e.clientY - rect.top) / rect.height;

    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'pointermove',
          uuid,
          coordinates: [x, y],
        })
      );
    } else {
      console.warn('WebSocket not open');
    }
  }


  onMount(() => {
    ws = new WebSocket(wsUrl());
    ws.onmessage = (ev) => {
      try {
        const id = JSON.parse(ev.data)["uuid"];
        const coords = JSON.parse(ev.data)["coordinates"];
        const x = coords[0];
        const y = coords[1];
        console.debug(ev.data)
        pushBlob(id, [x, y]);
      } catch (e) {
        console.error(e);
      }
    };

    return () => {
      ws?.close();
    };
  });

  // Stable FNV-1a → hue in [0,1)
  function hueFromUUID(id: string) {
    let h = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < id.length; i++) {
      h ^= id.charCodeAt(i);
      h = Math.imul(h, 0x01000193); // FNV prime
    }
    return (h >>> 0) / 0xffffffff;
  }

  const hueById = new Map<string, number>();

  function getHue(id: string) {
    let h = hueById.get(id);
    if (h == null) {
      h = hueFromUUID(id);
      hueById.set(id, h);
    }
    return h;
  }

  let canvas: HTMLCanvasElement;

  onMount(() => {
    const gl = canvas.getContext('webgl2')!;

    // ---------- DPR-aware resize ----------
    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width  * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    }
    const onResize = () => resize();
    window.addEventListener('resize', onResize);
    resize();

    // ---------- fullscreen quad ----------
    const QUAD_VS = `#version 300 es
    precision highp float;
    const vec2 V[6]=vec2[6](vec2(-1,-1),vec2(1,-1),vec2(1,1),
                            vec2(-1,-1),vec2(1,1),vec2(-1,1));
    out vec2 v_uv;
    void main(){
      vec2 p = V[gl_VertexID];
      v_uv = p*0.5+0.5;
      gl_Position = vec4(p,0.0,1.0);
    }`;

    // ---------- composite fragment (data-driven) ----------
    const COMPOSE_FS = `#version 300 es
    precision highp float;
    in vec2 v_uv; out vec4 outColor;
    uniform vec3  iResolution;
    uniform float iTime;

    // Packed layers: one texel per layer = (x, y, r, w)
    uniform sampler2D u_layers;
    uniform int       u_count;

    vec3 hsv2rgb(float h, float s, float v){
      float r = abs(h * 6.0 - 3.0) - 1.0;
      float g = 2.0 - abs(h * 6.0 - 2.0);
      float b = 2.0 - abs(h * 6.0 - 4.0);
      vec3  rgb = clamp(vec3(r,g,b), 0.0, 1.0);
      return v * mix(vec3(1.0), rgb, s);
    }

    // isotropic distance (correct for aspect so circles stay round)
    float blob(vec2 uv, vec2 c, float r, float aspect){
      vec2 d = vec2((uv.x - c.x) * aspect, uv.y - c.y);
      float L2 = dot(d,d);
      // Gaussian-ish falloff; tweak 2.0 for sharpness
      return exp(-L2 / (2.0 * r * r));
    }

    void main(){
      vec2 uv = v_uv;
      float aspect = iResolution.x / iResolution.y;

      vec3 acc = vec3(0.0);
      // static upper bound required in GLSL ES; pick comfortably large
      for (int i = 0; i < 1024; ++i) {
        if (i >= u_count) break;
        // Each texel holds (x, y, r, w)
        vec4 L = texelFetch(u_layers, ivec2(i, 0), 0);
        float b = blob(uv, L.xy, L.z, aspect);
        acc += hsv2rgb(L.w, 1.0, 1.0) * b;
      }
      outColor = vec4(acc, 1.0);
    }`;

    // ---------- tiny GL helpers ----------
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s) || 'shader compile');
      return s;
    };
    const link = (vs: string, fs: string) => {
      const p = gl.createProgram()!;
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(p) || 'program link');
      return p;
    };

    // ---------- build the program ----------
    const prog = link(QUAD_VS, COMPOSE_FS);
    gl.useProgram(prog);
    const u_iRes   = gl.getUniformLocation(prog, 'iResolution')!;
    const u_iTime  = gl.getUniformLocation(prog, 'iTime')!;
    const u_layers = gl.getUniformLocation(prog, 'u_layers')!;
    const u_count  = gl.getUniformLocation(prog, 'u_count')!;

    // ---------- data texture for layers ----------
    const MAX_LAYERS = 256; // bump if you need more
    const layerTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, layerTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // allocate 256x1 RGBA32F; we’ll update [0..count) each frame if needed
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, MAX_LAYERS, 1, 0, gl.RGBA, gl.FLOAT, null);
    gl.uniform1i(u_layers, 0); // texture unit 0

    // CPU-side layer buffer (x, y, r, w) * MAX
    const layerData = new Float32Array(MAX_LAYERS * 4);
    let layerCount = 0;
    let layerDirty = true;

    // helpers to manipulate layers
    function setLayer(i: number, x: number, y: number, r: number, w: number) {
      const base = i * 4;
      layerData[base + 0] = x;
      layerData[base + 1] = y;
      layerData[base + 2] = r;
      layerData[base + 3] = w;
      if (i >= layerCount) layerCount = i + 1;
      layerDirty = true;
    }
    function clearLayers(hard = false) {
      if (hard) layerData.fill(0); // optional: zero memory
      layerDirty = true;
      layerCount = 0;          // nothing is active
    }
    function uploadLayers() {
      if (!layerDirty) return;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, layerTex);
      // update only the used prefix [0..layerCount)
      if (layerCount > 0) {
        gl.texSubImage2D(
          gl.TEXTURE_2D, 0,
          0, 0,
          layerCount, 1,
          gl.RGBA, gl.FLOAT,
          layerData.subarray(0, layerCount * 4)
        );
      }
      layerDirty = false;
    }

    // ---------- draw each pair of blobs from blobCoordinates ----------
    $effect(() => {
      clearLayers();
      console.debug(blobCoordinates);
      Object.values(blobCoordinates).forEach((item) => {
        console.debug(item);
        const coords = item["coordinates"];
        const x = coords[0];
        const y = coords[1];
        const idx = Math.min(layerCount, MAX_LAYERS - 1);
        setLayer(idx, x, y, 0.12, getHue(item.uuid));
      });
    });

    // ---------- render loop ----------
    const t0 = performance.now();
    let raf = 0;
    function frame() {
      // Always clear first so previous frame doesn’t linger
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0.0); // transparent background; change if you want
      gl.clear(gl.COLOR_BUFFER_BIT);

      uploadLayers();

      gl.useProgram(prog);
      gl.uniform3f(u_iRes, canvas.width, canvas.height, 1.0);
      gl.uniform1f(u_iTime, (performance.now() - t0) * 0.001);
      gl.uniform1i(u_count, layerCount);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, layerTex);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    onDestroy(() => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    });
  });
</script>

<canvas bind:this={canvas} onpointermove={handlePointer} style="display:block;width:100vw;height:100vh;"></canvas>
