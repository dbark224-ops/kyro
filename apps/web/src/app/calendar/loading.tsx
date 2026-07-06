import { AppFrame } from "../components/app-frame";

export default function CalendarLoading() {
  return (
    <AppFrame active="Calendar">
      <header className="topbar">
        <div>
          <p className="eyebrow">Calendar</p>
          <h1>Calendar</h1>
        </div>
      </header>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Loading</p>
            <h2>Calendar is opening</h2>
          </div>
        </div>
        <p className="empty-copy">Loading events and linked work.</p>
      </section>
    </AppFrame>
  );
}
