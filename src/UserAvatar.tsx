import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { usePersonalizationOptional } from "./PersonalizationProvider";

export default function UserAvatar({ userId, name, className = "", style, children }: {
  userId?: string | null; name: string; className?: string; style?: CSSProperties; children?: ReactNode;
}) {
  const personal = usePersonalizationOptional();
  const me = personal?.me;
  const person = userId && me?.directory.find((item) => item.userId === userId);
  const self = !!userId && me?.userId === userId;
  const source = self ? me?.profile.avatarUrl : person ? person.avatarUrl : null;
  const displayName = (self ? me?.profile.fullName : person ? person.displayName : name) || name || "Usuário";
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);
  const initials = displayName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "?";
  return <span className={`vx-avatar ${className}`} style={{ overflow: "hidden", flexShrink: 0, ...style }} title={displayName}>
    {source && !failed
      ? <img src={source} alt={`Foto de ${displayName}`} onError={() => setFailed(true)} referrerPolicy="no-referrer" style={{ width: "100%", height: "100%", display: "block", objectFit: "cover", borderRadius: "inherit" }} />
      : children || initials}
  </span>;
}
