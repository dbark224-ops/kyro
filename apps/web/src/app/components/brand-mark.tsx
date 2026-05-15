import Image from "next/image";

export function BrandMark() {
  return (
    <div className="brand-mark">
      <Image alt="" className="brand-mark-image" height={40} priority src="/kyro-icon.png" width={40} />
    </div>
  );
}
