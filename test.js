// const axios = require('axios');
// const {writeFileSync,readFileSync,createWriteStream,unlinkSync, existsSync} = require('fs');
// const {join} = require('path');

// const init = async () =>{
//     file_download("fc3289b7-a47d-4715-b92e-73a9add51c8e.jpeg","https://ucarecdn.com/fc3289b7-a47d-4715-b92e-73a9add51c8e/IMG_3062.jpeg")

// }

// const file_download = async (file_name, url) => {
//     const filePath = join(process.cwd(), 'temp', file_name);
    
//     try {
//       const response = await axios.get(url, { responseType: 'stream' });
  
//       const writer = createWriteStream(filePath);
  
//       response.data.pipe(writer);
  
//       return new Promise((resolve, reject) => {
//         writer.on('finish', resolve);
//         writer.on('error', reject);
//       });
//     } catch (error) {
//       console.error('Error downloading file:', error);
//       if (error.response && error.response.status === 404) {
//         console.log('Fetching through uploadly------------------------');
//         try {
//           const response = await axios.get(`https://uploadly-files.com/${file_name}`, { responseType: 'stream' });
  
//           const writer = createWriteStream(filePath);
  
//           response.data.pipe(writer);
  
//           return new Promise((resolve, reject) => {
//             writer.on('finish', resolve);
//             writer.on('error', reject);
//           });
//         } catch (error) {
//           if (error.response && error.response.status === 400) {
//             console.error('Big file error:', error.response.data);
//           } else {
//             console.error('Error fetching through uploadly:', error);
//           }
//         }
//       }
//     }
// };

// init();

const fs = require('fs');
const Dropbox = require('dropbox');
const fetch = require('isomorphic-fetch');

const dbx = new Dropbox.Dropbox({
  fetch,
  accessToken: 'YOUR_ACCESS_TOKEN',
});

const fileContent = fs.readFileSync('path-to-your-large-file.zip');
const fileSize = fileContent.length;

dbx.filesUploadSessionStart({ close: false, contents: fileContent })
  .then((response) => {
    const sessionId = response.result.session_id;

    // Define the chunk size (4 MB is a reasonable chunk size)
    const chunkSize = 4 * 1024 * 1024;

    // Calculate the number of chunks
    const numChunks = Math.ceil(fileSize / chunkSize);

    let offset = 0;

    // Function to upload a chunk
    const uploadChunk = async (chunkData) => {
      return dbx.filesUploadSessionAppendV2({
        cursor: {
          session_id: sessionId,
          offset,
        },
        close: false,
        contents: chunkData,
      });
    };

    // Upload each chunk
    const uploadChunks = async () => {
      for (let i = 0; i < numChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(fileSize, start + chunkSize);
        const chunkData = fileContent.slice(start, end);

        await uploadChunk(chunkData);

        offset += chunkSize;

        console.log(`Uploaded chunk ${i + 1} of ${numChunks}`);
      }
    };

    // Finish the upload session
    const finishUpload = () => {
      return dbx.filesUploadSessionFinish({
        cursor: {
          session_id: sessionId,
          offset,
        },
        commit: {
          path: '/path-in-dropbox/large-file.zip',
        },
        contents: '',
      });
    };

    // Upload the chunks and finish the session
    uploadChunks()
      .then(() => finishUpload())
      .then(() => {
        console.log('File uploaded successfully.');
      })
      .catch((error) => {
        console.error('Error uploading file:', error);
      });
  })
  .catch((error) => {
    console.error('Error starting the upload session:', error);
  });
