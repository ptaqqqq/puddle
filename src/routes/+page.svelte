<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  let canvas: HTMLCanvasElement;

  onMount(() => {
    const gl = canvas.getContext('webgl2');
    if (gl === null) throw new Error('WebGL2 required');

    // --- targets must exist before resize runs ---
    const targets: Array<{tex: WebGLTexture; fb: WebGLFramebuffer; w: number; h: number}> = [];

    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();        // CSS pixels
      const w = Math.max(1, Math.floor(rect.width  * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));

      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
        targets.length = 0; // rebuild FBOs
      }
    }
    // optional: keep canvas styled via CSS (width:100vw;height:100vh)
    window.addEventListener('resize', resize);
    resize();

    const QUAD_VS = `#version 300 es
    precision highp float;
    const vec2 V[6]=vec2[6](vec2(-1,-1),vec2(1,-1),vec2(1,1),vec2(-1,-1),vec2(1,1),vec2(-1,1));
    out vec2 v_uv;
    void main(){ vec2 p = V[gl_VertexID]; v_uv = p*0.5+0.5; gl_Position = vec4(p,0.0,1.0); }`;

    const wrapShadertoy = (fsBody: string) => `#version 300 es
    precision highp float;
    in vec2 v_uv; out vec4 outColor;
    uniform vec3  iResolution; uniform float iTime; uniform vec4  iMouse;
    uniform sampler2D iChannel0; uniform sampler2D iChannel1;
    uniform sampler2D iChannel2; uniform sampler2D iChannel3;
    uniform vec2 u_params;
    ${fsBody}
    void main(){ vec2 fragCoord = v_uv * iResolution.xy; vec4 c=vec4(0.0); mainImage(c, fragCoord); outColor = c; }`;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    };
    const link = (vs: string, fs: string) => {
      const p = gl.createProgram()!;
      gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'program');
      return p;
    };
    const makeTarget = (w: number, h: number) => {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, canvas.width, canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return { tex, fb, w: canvas.width, h: canvas.height };
    };

    // ---- your passes (unchanged) ----
    let mouseParams = [0, 0];

    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();  // CSS pixels
      const x = (e.clientX - r.left) / r.width;
      const y = 1 - (e.clientY - r.top) / r.height; // flip Y for UV
      mouseParams[0] = Math.min(Math.max(x, 0), 1);
      mouseParams[1] = Math.min(Math.max(y, 0), 1);
    });


    const passes = [
      {
        name: 'A',
        source: `
        float pi = 3.14159265;

        float PDF_gaussian( in float x, in float mean, in float var )
        {
            return 1.0 / sqrt(2.0 * pi * var) * exp(-((x - mean) * (x - mean) / (2.0 * var)));
        }

        void mainImage( out vec4 fragColor, in vec2 fragCoord )
        {
            vec3 color = vec3(1.0, 1.0, 1.0);
            float r = 0.2;   
            float mu = 0.0;
            float sigma_2 = 0.3;
            
            vec2 aspect = vec2(1.0, iResolution.y / iResolution.x);

            // Normalized pixel coordinates (from 0 to 1)
            vec2 uv = fragCoord / iResolution.xy;
            // Already normalized
            vec2 O = u_params.xy;

            float p = PDF_gaussian(distance(uv * aspect, O * aspect) / r, mu, sigma_2);

            // Output to screen
            fragColor = vec4(color * p, 1.0);
        }
        `,
        params: mouseParams,
        inputFrom: null as number | null,
        present: true
      },
      // {
        // name: 'B',
        // source: `
        // void mainImage( out vec4 fragColor, in vec2 fragCoord )
        // {
            // fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        // }
        // `,
        // params: [0.0, 0.2],
        // inputFrom: 0,
        // present: true
      // }
    ];

    // compile once
    const programs = passes.map(p => link(QUAD_VS, wrapShadertoy(p.source)));
    const uniforms = programs.map(p => ({
      iRes: gl.getUniformLocation(p, 'iResolution')!,
      iTime: gl.getUniformLocation(p, 'iTime')!,
      iMouse: gl.getUniformLocation(p, 'iMouse')!,
      uParams: gl.getUniformLocation(p, 'u_params'),
      iCh0: gl.getUniformLocation(p, 'iChannel0'),
    }));

    function ensureTargets() {
      for (let i = 0; i < passes.length; i++) {
        if (!targets[i] || targets[i].w !== canvas.width || targets[i].h !== canvas.height) {
          targets[i] = makeTarget(canvas.width, canvas.height);
        }
      }
    }

    const mouse = new Float32Array(4);
    let mouseDown = false;
    const pm = (e: PointerEvent) => { if (mouseDown) { mouse[0]=e.clientX*(devicePixelRatio||1); mouse[1]=(innerHeight-e.clientY)*(devicePixelRatio||1); } };
    const pd = (e: PointerEvent) => { mouseDown = true; mouse[2]=1; pm(e); };
    const pu = () => { mouseDown = false; mouse[2]=0; };
    window.addEventListener('pointerdown', pd);
    window.addEventListener('pointerup', pu);
    window.addEventListener('pointermove', pm);

    const t0 = performance.now();
    let raf = 0;

    function setCommonUniforms(i: number) {
      gl.uniform3f(uniforms[i].iRes, canvas.width, canvas.height, 1.0);
      gl.uniform1f(uniforms[i].iTime, (performance.now() - t0) / 1000);
      gl.uniform4fv(uniforms[i].iMouse, mouse);
      const [px, py] = (passes[i] as any).params || [0,0];
      uniforms[i].uParams && gl.uniform2f(uniforms[i].uParams!, px, py);
    }
    function bindInputs(i: number) {
      const from = (passes[i] as any).inputFrom as number | null;
      if (from != null && uniforms[i].iCh0) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, targets[from].tex);
        gl.uniform1i(uniforms[i].iCh0!, 0);
      }
    }

    function frame() {
      ensureTargets();

      for (let i = 0; i < passes.length; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, targets[i].fb);
        gl.useProgram(programs[i]);
        setCommonUniforms(i);
        bindInputs(i);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }

      // present last pass marked present (fallback: last)
      let idx = passes.length - 1;
      for (let i = passes.length - 1; i >= 0; --i) if ((passes[i] as any).present) { idx = i; break; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.useProgram(programs[idx]);
      setCommonUniforms(idx);
      bindInputs(idx);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    onDestroy(() => {
      cancelAnimationFrame(raf);
      // window.removeEventListener('resize', onResize);
      window.removeEventListener('pointerdown', pd);
      window.removeEventListener('pointerup', pu);
      window.removeEventListener('pointermove', pm);
      // window.removeEventListener('pointermove', // TODO:);
    });
  });
</script>

<!-- Svelte-idiomatic: bind canvas ref -->
<canvas bind:this={canvas} id="gl" style="display:block; width:100vw; height:100vh;"></canvas>
