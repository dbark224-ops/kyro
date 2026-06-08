"use client";

import { useMemo, useState } from "react";

export type TeamPhoneNumberRow = {
  name: string | null;
  phoneNumber: string;
  role: string | null;
};

function emptyRow(): TeamPhoneNumberRow {
  return {
    name: "",
    phoneNumber: "",
    role: "",
  };
}

export function TeamPhoneNumberEditor({
  initialRows,
}: Readonly<{
  initialRows: TeamPhoneNumberRow[];
}>) {
  const seededRows = useMemo(
    () => (initialRows.length > 0 ? initialRows : [emptyRow()]),
    [initialRows],
  );
  const [rows, setRows] = useState(seededRows);

  function updateRow(
    index: number,
    key: keyof TeamPhoneNumberRow,
    value: string,
  ) {
    setRows((currentRows) =>
      currentRows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [key]: value } : row,
      ),
    );
  }

  function removeRow(index: number) {
    setRows((currentRows) => {
      const nextRows = currentRows.filter((_, rowIndex) => rowIndex !== index);

      return nextRows.length > 0 ? nextRows : [emptyRow()];
    });
  }

  return (
    <div className="team-phone-editor">
      <div className="team-phone-editor-heading">
        <div>
          <span>User and team phone numbers</span>
          <small>
            Internal callers are recognized from these numbers.
          </small>
        </div>
        <button
          className="secondary-button compact"
          onClick={() => setRows((currentRows) => [...currentRows, emptyRow()])}
          type="button"
        >
          Add
        </button>
      </div>

      <div className="team-phone-editor-rows">
        {rows.map((row, index) => (
          <div className="team-phone-editor-row" key={`${index}-${row.phoneNumber}`}>
            <label>
              Phone
              <input
                name="phoneAgentTeamPhone"
                onChange={(event) =>
                  updateRow(index, "phoneNumber", event.currentTarget.value)
                }
                placeholder="+61 400 000 000"
                value={row.phoneNumber}
              />
            </label>
            <label>
              Name
              <input
                name="phoneAgentTeamName"
                onChange={(event) =>
                  updateRow(index, "name", event.currentTarget.value)
                }
                placeholder="David"
                value={row.name ?? ""}
              />
            </label>
            <label>
              Role
              <input
                name="phoneAgentTeamRole"
                onChange={(event) =>
                  updateRow(index, "role", event.currentTarget.value)
                }
                placeholder="Owner"
                value={row.role ?? ""}
              />
            </label>
            <button
              className="icon-text-button"
              onClick={() => removeRow(index)}
              type="button"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
