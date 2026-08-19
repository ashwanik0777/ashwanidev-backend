const axios = require("axios");
async function run() {
  try {
    const res = await axios.put("https://backend.onlinegbu.com/api/v1/admin/announcements/events/52", {
      coverImageUrl: "https://test.com/new-image.jpg"
    }, {
      headers: {
        // Need auth token?
      }
    });
    console.log(res.data);
  } catch (e) {
    console.log(e.response?.data || e.message);
  }
}
run();
