import Image from "next/image";

export function BrandMark() {
  return (
    <div aria-label="Kyro AI Assistant" className="brand-mark" role="img">
      <Image
        alt=""
        aria-hidden="true"
        className="brand-mark-image"
        height={500}
        priority
        src="/brand/kyro-logo.png"
        width={1024}
      />
    </div>
  );
}
