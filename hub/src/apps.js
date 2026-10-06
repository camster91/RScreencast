// Apps listed on the home page, in this order.
// Icons are Lucide (https://lucide.dev, ISC license) SVG bodies.
// hidden: true keeps an app off the page (e.g. while it is offline).
export const APPS = [
  {
    name: "Cast",
    path: "/cast/",
    description: "Share your laptop screen to the room display. Scan the QR code on the screen or enter the room code.",
    icon: '<path d="m9 10 3-3 3 3"/><path d="M12 13V7"/><rect width="20" height="14" x="2" y="3" rx="2"/><path d="M12 17v4"/><path d="M8 21h8"/>'
  },
  {
    name: "Clicker",
    path: "/clicker/",
    description: "Use your phone as a PowerPoint clicker.",
    icon: '<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>'
  },
  {
    name: "Booking",
    path: "/book",
    description: "Book the AV team for your event.",
    icon: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="m9 16 2 2 4-4"/>'
  },
  {
    name: "Mics",
    path: "/mics/",
    hidden: true, // not hosted anywhere right now; /mics/ would show "Page not found"
    description: "Microphone management.",
    staffOnly: true,
    icon: '<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>'
  }
];
