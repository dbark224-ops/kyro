import { addressVerificationDisplay } from "../../lib/addresses/status";

/**
 * Says whether anyone has confirmed an address.
 *
 * Kyro stores a verification verdict on every address it saves and has done for
 * a while, but nothing ever showed it, so an address a customer typed into an
 * email looked exactly like one Google had confirmed. On a job you are about to
 * drive to, that is the difference worth seeing.
 *
 * Renders nothing when there is no address, so callers can drop it in beside a
 * possibly-empty field without guarding.
 */
export function AddressVerificationBadge({
  address,
  status,
}: Readonly<{
  address: string | null | undefined;
  status: string | null | undefined;
}>) {
  if (!address?.trim()) {
    return null;
  }

  const display = addressVerificationDisplay(status);

  if (!display) {
    return null;
  }

  return (
    <span
      className={`address-verification address-verification-${display.tone}`}
      title={display.title}
    >
      {display.label}
    </span>
  );
}

/**
 * The address and its badge as one unit, for the label/value fact lists where
 * the value is otherwise a bare string.
 */
export function AddressWithVerification({
  address,
  status,
}: Readonly<{
  address: string | null | undefined;
  status: string | null | undefined;
}>) {
  if (!address?.trim()) {
    return <>-</>;
  }

  return (
    <span className="address-with-verification">
      <span>{address}</span>
      <AddressVerificationBadge address={address} status={status} />
    </span>
  );
}
