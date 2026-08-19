const { buildColumnValues } = require("./src/modules/announcements/store");
const body = { coverImageUrl: "old-url.jpg", coverImage: "new-url.jpg" };
const { columns, values } = buildColumnValues("events", body, { partial: true });
console.log(columns, values);
