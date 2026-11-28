declare module "*.wgsl" {
  import type { ShaderSource } from "vgpu";

  const source: ShaderSource;
  export default source;
}
