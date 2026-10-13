import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { Quality } from './quality';

export class Renderer {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer | null = null;
  bloom: UnrealBloomPass | null = null;
  private renderPass: RenderPass | null = null;

  constructor(container: HTMLElement, private q: Quality) {
    this.renderer = new THREE.WebGLRenderer({ antialias: q.antialias && !q.bloom, powerPreference: 'high-performance', stencil: false });
    const r = this.renderer;
    r.setPixelRatio(q.pixelRatio);
    r.setSize(window.innerWidth, window.innerHeight);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1;
    r.shadowMap.enabled = q.shadows;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(r.domElement);
    r.domElement.id = 'game-canvas';
    window.addEventListener('resize', () => this.resize());
  }

  setup(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    if (!this.q.bloom) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: this.q.antialias ? 4 : 0 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.35, 0.5, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setCamera(camera: THREE.PerspectiveCamera) {
    if (this.renderPass) this.renderPass.camera = camera;
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, exposure: number) {
    this.renderer.toneMappingExposure = exposure;
    if (this.composer) this.composer.render();
    else this.renderer.render(scene, camera);
  }

  resize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (this.composer) {
      this.composer.setSize(window.innerWidth, window.innerHeight);
    }
    this.onResize();
  }

  onResize: () => void = () => {};
}
