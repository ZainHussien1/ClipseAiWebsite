interface KbdProps {
  keys: string[];
}

export function Kbd({ keys }: KbdProps) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((key) => (
        <kbd key={key} className="kbd">
          {key}
        </kbd>
      ))}
    </span>
  );
}
