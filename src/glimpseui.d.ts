declare module "glimpseui" {
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
