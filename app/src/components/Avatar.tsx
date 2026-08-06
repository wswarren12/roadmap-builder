'use client';

import { initials } from '@/lib/team';

/**
 * Person avatar (F-13): LabOS profile image when known, otherwise the
 * person's initials. Sized via the `size` prop (px).
 */
export function Avatar({
  name,
  image,
  size = 24,
  testId,
}: {
  name: string;
  image: string | null;
  size?: number;
  testId?: string;
}) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  if (image) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="avatar-chip"
        src={image}
        alt={name}
        title={name}
        style={style}
        data-testid={testId}
      />
    );
  }
  return (
    <span className="avatar-chip avatar-chip--initials" title={name} style={style} data-testid={testId}>
      {initials(name)}
    </span>
  );
}
