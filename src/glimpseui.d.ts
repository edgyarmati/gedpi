declare module "glimpseui" {
  import { EventEmitter } from "node:events";

  export interface GlimpseWindow extends EventEmitter {
    on(event: "message", listener: (data: unknown) => void): this;
    on(event: "closed", listener: () => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    removeListener(event: "message", listener: (data: unknown) => void): this;
    removeListener(event: "closed", listener: () => void): this;
    removeListener(event: "error", listener: (error: Error) => void): this;
    close(): void;
  }

  export function open(
    html: string,
    options: {
      width?: number;
      height?: number;
      title?: string;
      frameless?: boolean;
      floating?: boolean;
      transparent?: boolean;
      openLinks?: boolean;
      timeout?: number;
    },
  ): GlimpseWindow;

  export function prompt<T = unknown>(
    html: string,
    options: {
      width?: number;
      height?: number;
      title?: string;
      frameless?: boolean;
      floating?: boolean;
      transparent?: boolean;
      openLinks?: boolean;
      timeout?: number;
    },
  ): Promise<T | null>;
}
