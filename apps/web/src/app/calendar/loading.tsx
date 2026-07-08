import { AppFrame } from "../components/app-frame";
import styles from "./calendar-board.module.css";

export default function CalendarLoading() {
  return (
    <AppFrame active="Calendar">
      <div className={styles.calendarShell} aria-busy="true">
        <section className={styles.calendarPanel}>
          <div className={styles.calendarPanelHeader}>
            <div className={styles.calendarTitleCluster}>
              <div className={styles.calendarTitleLine}>
                <div className={styles.calendarTitle}>
                  <h2>Loading calendar</h2>
                </div>
                <div className={styles.viewSwitch} aria-hidden="true">
                  <button data-active="true" disabled type="button">
                    Week
                  </button>
                  <button disabled type="button">
                    Month
                  </button>
                </div>
              </div>
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
