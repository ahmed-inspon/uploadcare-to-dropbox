const express = require('express');
const bodyparser = require('body-parser');
var Dropbox = require('dropbox').Dropbox;
const axios = require('axios');
const {writeFileSync,readFileSync,unlinkSync} = require('fs');
const { join } = require('path');
const dotenv = require('dotenv');
const FormData = require('form-data');
dotenv.config();
const app = express();
app.use(bodyparser.json());

app.get('/',(req,res)=>{
    res.send("hello world");
})

const get_refresh_token = async ()=>{
  let data = new FormData();
  data.append('client_id', process.env.CLIENT_ID);
  data.append('client_secret', process.env.CLIENT_SECRET);
  data.append('refresh_token', process.env.REFRESH_TOKEN);
  data.append('grant_type', 'refresh_token');

  let config = {
    method: 'post',
    maxBodyLength: Infinity,
    url: 'https://api.dropbox.com/oauth2/token',
    headers: { 
      'Cookie': 'locale=en; t=96qUVQ_4RiZfwhmL0qvzOvgD', 
      ...data.getHeaders()
    },
    data : data
  };

  try {
    const response = await axios.request(config);
    let {data} = response;
    if(data && data.access_token){
      return data.access_token
    }
  }
  catch (error) {
    console.log(error);
    return null
  }
}

let sample = {
    "data": {
      "content_info": { mime: [Object], image: [Object] },
      "uuid": "d9b26444-3cf4-408d-9211-be299f41dccc",
      "is_image": true,
      "is_ready": true,
      "metadata": {},
      "appdata": {},
      "mime_type": "image/jpeg",
      "original_filename": "inbound8868601096635665276.jpg",
      "original_file_url": "https://ucarecdn.com/d9b26444-3cf4-408d-9211-be299f41dccc/inbound8868601096635665276.jpg",
      "datetime_removed": null,
      "size": 12278610,
      "datetime_stored": null,
      "url": "https://api.uploadcare.com/files/d9b26444-3cf4-408d-9211-be299f41dccc/",
      "datetime_uploaded": "2023-10-12T09:25:45.598409Z",
      "variations": null
    },
    "file": "https://ucarecdn.com/d9b26444-3cf4-408d-9211-be299f41dccc/inbound8868601096635665276.jpg"
  }
app.post('/webhook',async(req,res)=>{
    let {data,file} = req.body;
    // console.log("payload---->",data,'<----payload')
    const fileResponse = await axios({
        url: file,
        method: "GET",
        responseType: "arraybuffer",
    });
    let file_uuid = data.uuid;
    let ext = data.original_filename.split('.')[data.original_filename.split(".").length-1];
    let file_name = file_uuid+"."+ext;
    writeFileSync(join(process.cwd(),'temp',file_name),Buffer.from(fileResponse.data),{encoding:'binary'});
    let file_content = readFileSync(join(process.cwd(),'temp',file_name));
    let today = new Date();
    let path = today.getFullYear()+"/"+(today.getMonth()+1);
    var dbx = new Dropbox({ accessToken: await get_refresh_token()});
    dbx.filesUpload({path: "/"+path+"/"+file_name, contents: file_content}).then((res)=>{
        console.log("File Upload at",new Date())
        try{
          unlinkSync(join(process.cwd(),'temp',file_name));
        }
        catch(err){
          console.log('err',err);
        }
      }).catch((err)=>{
        console.log("dropbox err",err);
    })
    res.json({success:true,data})
})

app.listen(7000,()=>{
    console.log("server started");    
})