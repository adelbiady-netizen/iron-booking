import { useEffect, useState } from "react";
import { io } from "socket.io-client";

const socket = io("http://localhost:3001");

const API_BASE = "http://localhost:3001/api/v1";
const RESTAURANT_ID = "cmnvm3k0c0000m8oshrbifaqv";

type BoardReservation = {
  id: string;
  guestName: string;
  guestCount: number;
  startTime: string;
  endTime: string;
  status: string;
  capacityOverride?: boolean;
  reservedSoonOverride?: boolean;
  overrideNote?: string | null;
};

type TableBoardItem = {
  id: string;
  name: string;
  capacity: number;
  status: "AVAILABLE" | "OCCUPIED_NOW" | "RESERVED_SOON";
  timeStatus: "NORMAL" | "ENDING_SOON" | "OVERTIME";
  activeReservation: BoardReservation | null;
  upcomingReservation: BoardReservation | null;
};

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function App() {
  const [tables, setTables] = useState<TableBoardItem[]>([]);
  const [toast, setToast] = useState("");
  const [showForceModal, setShowForceModal] = useState(false);
  const [pendingGuestCount, setPendingGuestCount] = useState(2);
  const [submitting, setSubmitting] = useState(false);

  const fetchBoard = async () => {
    try {
      const res = await fetch(
        `${API_BASE}/tables/board?restaurantId=${RESTAURANT_ID}`
      );
      const data = await res.json();
      setTables(data.data || []);
    } catch (error) {
      console.error("Failed to fetch board", error);
    }
  };

  useEffect(() => {
    fetchBoard();
  }, []);

  useEffect(() => {
    let toastTimer: ReturnType<typeof setTimeout> | null = null;

    const handleBoardUpdate = async () => {
      setToast(`Board updated at ${new Date().toLocaleTimeString()}`);

      if (toastTimer) {
        clearTimeout(toastTimer);
      }

      toastTimer = setTimeout(() => {
        setToast("");
      }, 4000);

      await fetchBoard();
    };

    socket.on("board:update", handleBoardUpdate);

    return () => {
      socket.off("board:update", handleBoardUpdate);
      if (toastTimer) {
        clearTimeout(toastTimer);
      }
    };
  }, []);

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 4000);
  };

  const handleWalkIn = async (guestCount = 2, force = false) => {
    try {
      setSubmitting(true);

      const res = await fetch(`${API_BASE}/reservations/walk-in`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          restaurantId: RESTAURANT_ID,
          guestName: "Walk-in",
          guestCount,
          force,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        const errorMessage =
          data?.error?.message || data?.error || "Walk-in failed";

        if (!force) {
          setPendingGuestCount(guestCount);
          setShowForceModal(true);
          showToast("No ideal table found. Force option available.");
          return;
        }

        showToast(typeof errorMessage === "string" ? errorMessage : "Walk-in failed");
        return;
      }

      if (force) {
        showToast("Guest seated with force override");
      } else {
        showToast("Walk-in seated successfully");
      }

      setShowForceModal(false);
      await fetchBoard();
    } catch (error) {
      console.error("Walk-in failed", error);
      showToast("Walk-in failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleComplete = async (id: string) => {
    try {
      setSubmitting(true);

      const res = await fetch(`${API_BASE}/reservations/${id}/complete`, {
        method: "PATCH",
      });

      if (!res.ok) {
        showToast("Complete failed");
        return;
      }

      showToast("Reservation completed");
      await fetchBoard();
    } catch (error) {
      console.error("Complete failed", error);
      showToast("Complete failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleExtend = async (id: string, minutes: number) => {
    try {
      setSubmitting(true);

      const res = await fetch(`${API_BASE}/reservations/${id}/extend`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ minutes }),
      });

      if (!res.ok) {
        showToast("Extend failed");
        return;
      }

      showToast(`Table extended by ${minutes} minutes`);
      await fetchBoard();
    } catch (error) {
      console.error("Extend failed", error);
      showToast("Extend failed");
    } finally {
      setSubmitting(false);
    }
  };

  const getCardBackground = (table: TableBoardItem) => {
    const hasOverride =
      table.activeReservation?.capacityOverride ||
      table.activeReservation?.reservedSoonOverride;

    if (hasOverride) return "#a855f7";
    if (table.timeStatus === "OVERTIME") return "#ef4444";
    if (table.timeStatus === "ENDING_SOON") return "#f59e0b";
    if (table.status === "AVAILABLE") return "#22c55e";
    return "#3b82f6";
  };

  const getStatusText = (table: TableBoardItem) => {
    const hasOverride =
      table.activeReservation?.capacityOverride ||
      table.activeReservation?.reservedSoonOverride;

    if (hasOverride) return "Force Override";
    if (table.timeStatus === "OVERTIME") return "Overtime";
    if (table.timeStatus === "ENDING_SOON") return "Ending Soon";
    if (table.status === "OCCUPIED_NOW") return "Occupied";
    if (table.status === "RESERVED_SOON") return "Reserved Soon";
    return "Available";
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f3f4f6",
        padding: 30,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 1280,
          margin: "0 auto",
        }}
      >
        <h1
          style={{
            textAlign: "center",
            fontSize: 52,
            marginBottom: 12,
          }}
        >
          🔥 Iron Booking LIVE
        </h1>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 12,
            marginBottom: 30,
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={() => handleWalkIn(2)}
            disabled={submitting}
            style={{
              padding: "12px 18px",
              borderRadius: 10,
              border: "1px solid #cbd5e1",
              background: "#fff",
              cursor: "pointer",
              fontSize: 16,
              fontWeight: 700,
            }}
          >
            ➕ Walk-in 2
          </button>

          <button
            onClick={() => handleWalkIn(4)}
            disabled={submitting}
            style={{
              padding: "12px 18px",
              borderRadius: 10,
              border: "1px solid #cbd5e1",
              background: "#fff",
              cursor: "pointer",
              fontSize: 16,
              fontWeight: 700,
            }}
          >
            ➕ Walk-in 4
          </button>

          <button
            onClick={fetchBoard}
            disabled={submitting}
            style={{
              padding: "12px 18px",
              borderRadius: 10,
              border: "1px solid #cbd5e1",
              background: "#0f172a",
              color: "#fff",
              cursor: "pointer",
              fontSize: 16,
              fontWeight: 700,
            }}
          >
            Refresh
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 20,
          }}
        >
          {tables.map((table) => {
            const hasOverride =
              table.activeReservation?.capacityOverride ||
              table.activeReservation?.reservedSoonOverride;

            return (
              <div
                key={table.id}
                style={{
                  padding: 24,
                  borderRadius: 20,
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: getCardBackground(table),
                  color: "#fff",
                  minHeight: 300,
                  boxShadow: "0 10px 25px rgba(0,0,0,0.12)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <h3
                      style={{
                        margin: 0,
                        fontSize: 24,
                      }}
                    >
                      {table.name}
                    </h3>

                    <div
                      style={{
                        background: "rgba(255,255,255,0.18)",
                        padding: "6px 10px",
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 800,
                      }}
                    >
                      {getStatusText(table)}
                    </div>
                  </div>

                  <div
                    style={{
                      fontSize: 16,
                      marginTop: 14,
                      opacity: 0.95,
                    }}
                  >
                    Capacity {table.capacity}
                  </div>

                  {table.activeReservation ? (
                    <>
                      <div
                        style={{
                          fontSize: 19,
                          marginTop: 18,
                          fontWeight: 800,
                        }}
                      >
                        {table.activeReservation.guestName}
                      </div>

                      <div
                        style={{
                          fontSize: 16,
                          marginTop: 8,
                        }}
                      >
                        {table.activeReservation.guestCount} guests
                      </div>

                      <div
                        style={{
                          fontSize: 16,
                          marginTop: 8,
                        }}
                      >
                        {formatTime(table.activeReservation.startTime)} -{" "}
                        {formatTime(table.activeReservation.endTime)}
                      </div>

                      {hasOverride && (
                        <div
                          style={{
                            marginTop: 12,
                            background: "rgba(255,255,255,0.16)",
                            borderRadius: 12,
                            padding: "10px 12px",
                            fontSize: 13,
                            fontWeight: 700,
                          }}
                        >
                          ⚠️ {table.activeReservation.overrideNote || "Force override used"}
                        </div>
                      )}
                    </>
                  ) : table.upcomingReservation ? (
                    <>
                      <div
                        style={{
                          fontSize: 19,
                          marginTop: 18,
                          fontWeight: 800,
                        }}
                      >
                        {table.upcomingReservation.guestName}
                      </div>

                      <div
                        style={{
                          fontSize: 16,
                          marginTop: 8,
                        }}
                      >
                        Upcoming reservation
                      </div>

                      <div
                        style={{
                          fontSize: 16,
                          marginTop: 8,
                        }}
                      >
                        Starts at {formatTime(table.upcomingReservation.startTime)}
                      </div>
                    </>
                  ) : (
                    <div
                      style={{
                        fontSize: 18,
                        marginTop: 24,
                        fontWeight: 700,
                      }}
                    >
                      Ready for service
                    </div>
                  )}
                </div>

                <div
                  style={{
                    marginTop: 20,
                    display: "grid",
                    gap: 10,
                  }}
                >
                  {table.activeReservation && (
                    <>
                      <button
                        onClick={() => handleExtend(table.activeReservation!.id, 15)}
                        disabled={submitting}
                        style={{
                          padding: "10px 16px",
                          borderRadius: 10,
                          border: "none",
                          background: "#fbbf24",
                          color: "#111827",
                          fontWeight: 800,
                          cursor: "pointer",
                          width: "100%",
                        }}
                      >
                        +15 min
                      </button>

                      <button
                        onClick={() => handleExtend(table.activeReservation!.id, 30)}
                        disabled={submitting}
                        style={{
                          padding: "10px 16px",
                          borderRadius: 10,
                          border: "none",
                          background: "#fde68a",
                          color: "#111827",
                          fontWeight: 800,
                          cursor: "pointer",
                          width: "100%",
                        }}
                      >
                        +30 min
                      </button>

                      <button
                        onClick={() => handleComplete(table.activeReservation!.id)}
                        disabled={submitting}
                        style={{
                          padding: "10px 16px",
                          borderRadius: 10,
                          border: "none",
                          background: "#ffffff",
                          color: "#111827",
                          fontWeight: 800,
                          cursor: "pointer",
                          width: "100%",
                        }}
                      >
                        Complete
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showForceModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9998,
            padding: 20,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 460,
              background: "#fff",
              borderRadius: 20,
              padding: 24,
              boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
            }}
          >
            <div
              style={{
                fontSize: 24,
                fontWeight: 800,
                color: "#0f172a",
                marginBottom: 12,
              }}
            >
              ⚠️ Force Seating Warning
            </div>

            <div
              style={{
                color: "#334155",
                fontSize: 16,
                lineHeight: 1.6,
                marginBottom: 18,
              }}
            >
              No ideal table was found for this walk-in.
              <br />
              You can still force-seat the guest on a free table even if it is too
              small or reserved soon.
            </div>

            <div
              style={{
                background: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: 16,
                padding: 16,
                marginBottom: 20,
              }}
            >
              <div style={{ fontWeight: 700, color: "#0f172a" }}>
                Guest count: {pendingGuestCount}
              </div>
              <div style={{ color: "#64748b", marginTop: 8, fontSize: 14 }}>
                The system will save override flags like capacity override or
                reserved soon override when needed.
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              <button
                onClick={() => {
                  setShowForceModal(false);
                  showToast("Force seating cancelled");
                }}
                disabled={submitting}
                style={{
                  padding: "12px 16px",
                  borderRadius: 12,
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  color: "#0f172a",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>

              <button
                onClick={() => handleWalkIn(pendingGuestCount, true)}
                disabled={submitting}
                style={{
                  padding: "12px 16px",
                  borderRadius: 12,
                  border: "none",
                  background: "#7c3aed",
                  color: "#fff",
                  fontWeight: 800,
                  cursor: "pointer",
                }}
              >
                Force Seat
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            background: "#0f172a",
            color: "#fff",
            padding: "14px 18px",
            borderRadius: 12,
            fontWeight: 700,
            boxShadow: "0 12px 30px rgba(0,0,0,0.25)",
            zIndex: 9999,
            minWidth: 220,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

export default App;