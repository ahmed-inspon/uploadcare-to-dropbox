const axios = require('axios');
const {writeFileSync,readFileSync,createWriteStream,unlinkSync, existsSync} = require('fs');
const {join} = require('path');

const init = async () =>{
    file_download("fc3289b7-a47d-4715-b92e-73a9add51c8e.jpeg","https://ucarecdn.com/fc3289b7-a47d-4715-b92e-73a9add51c8e/IMG_3062.jpeg")

}

const file_download = async (file_name, url) => {
    const filePath = join(process.cwd(), 'temp', file_name);
    
    try {
      const response = await axios.get(url, { responseType: 'stream' });
  
      const writer = createWriteStream(filePath);
  
      response.data.pipe(writer);
  
      return new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
    } catch (error) {
      console.error('Error downloading file:', error);
      if (error.response && error.response.status === 404) {
        console.log('Fetching through uploadly------------------------');
        try {
          const response = await axios.get(`https://uploadly-files.com/${file_name}`, { responseType: 'stream' });
  
          const writer = createWriteStream(filePath);
  
          response.data.pipe(writer);
  
          return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
          });
        } catch (error) {
          if (error.response && error.response.status === 400) {
            console.error('Big file error:', error.response.data);
          } else {
            console.error('Error fetching through uploadly:', error);
          }
        }
      }
    }
};

init();