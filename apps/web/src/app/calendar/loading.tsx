import { AppFrame } from "../components/app-frame";
import styles from "./calendar-board.module.css";

export default function CalendarLoading() {
  return (
    <AppFrame active="Calendar">
      <header className="topbar">
        <div>
          <p className="eyebrow">Calendar</p>
          <h1>Calendar</h1>
        </div>
      </header>

      <div className={styles.calendarShell} aria-busy="true">
        <div className={styles.calendarToolbar}>
          <div className={styles.calendarToolbarLeft}>
            <div className={styles.viewSwitch} aria-hidden="true">
              <button data-active="true" disabled type="button">
                Week
              </button>
              <button disabled type="button">
                Month
              </button>
            </div>
          </div>
        </div>
        <section className={styles.calendarPanel}>
          <div className={styles.calendarPanelHeader}>
            <div className={styles.calendarTitle}>
              <p className="eyebrow">Calendar</p>
              <h2>Loading calendar</h2>
              <p>Getting events and linked work.</p>
            </div>
            <div className={styles.calendarPendingOverlay}>
              <span
                className={styles.calendarPendingSpinner}
                aria-hidden="true"
              />
              <span>Loading calendar</span>
            </div>
          </div>
          <div className={styles.calendarLoadingGrid} aria-hidden="true">
            {Array.from({ length: 21 }, (_, index) => (
              <span className={styles.calendarLoadingCell} key={index} />
            ))}
          </div>
        </section>
      </div>
    </AppFrame>
  );
}
