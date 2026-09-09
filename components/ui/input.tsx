import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // 44px: alvo de toque confortável. O campo vive em Paper com hairline
          // Cloud — no foco a borda ESCURECE para tinta, sem brilho e sem cor:
          // foco não é ação, e vermillion aqui seria ruído.
          "flex h-11 w-full rounded-md border border-border-strong bg-surface px-4 py-2",
          "text-sm text-text placeholder:text-text-subtle",
          "transition-[border-color] duration-fast ease-out",
          "hover:border-iron",
          "focus-visible:border-text focus-visible:outline-hidden",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-text",
          "disabled:cursor-not-allowed disabled:opacity-55",
          "aria-[invalid=true]:border-error aria-[invalid=true]:focus-visible:ring-error-bg",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
