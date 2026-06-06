"use client";

type AutoSubmitSelectOption = Readonly<{
  label: string;
  value: string;
}>;

type AutoSubmitSelectProps = Readonly<{
  className?: string;
  defaultValue: string;
  id: string;
  label: string;
  name: string;
  options: readonly AutoSubmitSelectOption[];
}>;

export function AutoSubmitSelect({
  className,
  defaultValue,
  id,
  label,
  name,
  options,
}: AutoSubmitSelectProps) {
  return (
    <label className={className} htmlFor={id}>
      {label}
      <select
        defaultValue={defaultValue}
        id={id}
        name={name}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
