type ProjectBreadcrumbAvatarProps = {
  name: string;
};

const projectMonogram = (name: string): string => {
  const letters = name
    .split(/[\s-_]+/)
    .filter(Boolean)
    .map((part) => Array.from(part)[0])
    .join('');
  return (letters || name).slice(0, 2).toUpperCase();
};

export function ProjectBreadcrumbAvatar({
  name,
}: ProjectBreadcrumbAvatarProps) {
  return (
    <span
      aria-hidden="true"
      className="flex h-[20px] min-w-[20px] shrink-0 items-center justify-center rounded-full bg-[var(--primary)] px-1 font-mono text-[9px] font-medium leading-none text-white"
    >
      {projectMonogram(name)}
    </span>
  );
}
