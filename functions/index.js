/* eslint-disable object-curly-spacing */

const { initializeApp } = require("firebase-admin/app");
const { getStorage } = require("firebase-admin/storage");
const { storage } = require("firebase-functions/v1");
const path = require("path");
const os = require("os");
const fs = require("fs");
const ffmpegPath = require("@ffmpeg-installer/ffmpeg").path;
const ffmpeg = require("fluent-ffmpeg");
const { v4: uuidv4 } = require("uuid");
ffmpeg.setFfmpegPath(ffmpegPath);

initializeApp();

exports.generateThumbnail = storage.object().onFinalize(async (object, context) => {
   const fileBucket = object.bucket;
   const filePath = object.name;
   const contentType = object.contentType;
   const dir = path.dirname(filePath);
   const fileName = path.basename(filePath);

   if (!checkVideoDirectory(dir) || !contentType.includes("video/")) return;

   try {
      const bucket = getStorage().bucket(fileBucket);
      const tempFilePath = path.join(os.tmpdir(), fileName);

      await bucket.file(filePath).download({ destination: tempFilePath });

      if (!fs.existsSync(tempFilePath)) throw "Could not locate downloaded file";

      const thumbfileName =
         process.env.THUMBNAIL_PREFIX +
         removeFileExtension(fileName) +
         process.env.THUMBNAIL_SUFFIX +
         ".png";

      const localThumbFilePath = path.join(os.tmpdir(), thumbfileName);

      const newPath = process.env.THUMBNAIL_PATH === "~" ? dir + "/" : process.env.THUMBNAIL_PATH;
      const cloudThumbFilePath = path.join(newPath, thumbfileName);

      await takeScreenshot(tempFilePath, thumbfileName);

      if (!fs.existsSync(localThumbFilePath)) throw "Failed to locate generated file";

      await bucket.upload(localThumbFilePath, {
         destination: cloudThumbFilePath,
         metadata: {
            contentType: "image/png",
            metadata: {
               firebaseStorageDownloadTokens: uuidv4()
            }
         },
         public: false
      });

      fs.unlinkSync(localThumbFilePath);
      fs.unlinkSync(tempFilePath);
   } catch (error) {
      console.error("Error generating thumbnail:", error);
   }

   return null;
});

async function takeScreenshot(videoFilePath, newFileName) {
   return new Promise((resolve, reject) => {
      ffmpeg({ source: videoFilePath })
         .on("filenames", (filenames) => {})
         .on("end", () => {
            resolve(null);
         })
         .on("error", (error) => {
            console.error(error);
            reject(error);
         })
         .takeScreenshots(
            {
               count: 1,
               timestamps: [process.env.TIMESTAMP], //in seconds
               filename: newFileName
            },
            os.tmpdir()
         )
         .withAspectRatio(process.env.ASPECT_RATIO);
   });
}

function checkVideoDirectory(dir) {
   const VIDEO_PATH = process.env.VIDEO_PATH;
   const trimmedPath = VIDEO_PATH.replace(/^\/|\/$/g, "");
   const trimmedDir = dir.replace(/^\/|\/$/g, "");

   if (
      VIDEO_PATH === "~" ||
      (["", ".", "/"].includes(VIDEO_PATH) && dir === ".") ||
      trimmedPath == trimmedDir
   ) {
      return true;
   } else return false;
}

function removeFileExtension(filename) {
   const lastDotIndex = filename.lastIndexOf(".");
   return filename.substring(0, lastDotIndex);
}