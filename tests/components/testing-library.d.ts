// Ambient module declarations for test-time dependencies that are not yet in
// package.json. The reconciliation step should add @testing-library/react,
// @testing-library/jest-dom, and happy-dom to devDependencies and remove this
// file. The render test (`organization-switcher.test.tsx`) consumes these
// shapes so its typecheck stays green until then.

declare module "@testing-library/react" {
  export interface RenderResult {
    unmount: () => void;
    container: HTMLElement;
    baseElement: HTMLElement;
    rerender: (ui: unknown) => void;
  }
  export function render(ui: unknown): RenderResult;
  export const screen: {
    getByRole: (role: string, options?: { name?: RegExp | string }) => HTMLElement;
    queryByRole: (role: string, options?: { name?: RegExp | string }) => HTMLElement | null;
    getByText: (text: string | RegExp) => HTMLElement;
  };
}

declare module "@testing-library/jest-dom/vitest";
