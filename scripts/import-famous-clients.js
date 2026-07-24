const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const prisma = new PrismaClient();
const outDir = path.join(
  __dirname,
  '../../spacepoint-app/public/famous-clients'
);

const clients = [
  {
    name: 'tubaraomc',
    subtitle: '60,9 mil',
    image:
      'https://instagram.fipn8-1.fna.fbcdn.net/v/t51.82787-19/730090012_18355969561244475_6698469287010266543_n.jpg?stp=dst-jpg_s150x150_tt6&efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLmRqYW5nby4xMDgwLmMyIn0&_nc_ht=instagram.fipn8-1.fna.fbcdn.net&_nc_cat=103&_nc_oc=Q6cZ2gGixVNqmfB6CuQ8ojjTkqp84Pq8PCUVGTw3ai0g82dT-rQuftgsY9_FIIu3G4ifQjg&_nc_ohc=WJnLuhdDWyoQ7kNvwF8uDBB&_nc_gid=z46v2gtJO-tachSG66ly3A&edm=AP4sbd4BAAAA&ccb=7-5&oh=00_AQCkgN_Ku7lgIL8eYD1Q2GlAlbvvj6Gwm1VP33GgbewZUw&oe=6A68D5A2&_nc_sid=7a9f4b',
    videoUrl: 'https://www.instagram.com/stories/highlights/17867189085194624/',
  },
  {
    name: 'dherikemici',
    subtitle: '69,3 mil',
    image:
      'https://instagram.fipn8-1.fna.fbcdn.net/v/t51.82787-19/754453680_18082316636670978_5995784758603710712_n.jpg?stp=dst-jpg_s150x150_tt6&efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLmRqYW5nby4xMDgwLmMyIn0&_nc_ht=instagram.fipn8-1.fna.fbcdn.net&_nc_cat=106&_nc_oc=Q6cZ2gFIfn-dGeNAj647Ehy1DnSMZa6eqpfXBp9-NHW6wzYHRfolGKB__8UYoWRCwXOTJ3E&_nc_ohc=v4wZ8ndHPpgQ7kNvwGq1rpW&_nc_gid=thPLBg_TeUagVnwEmoJG4g&edm=AP4sbd4BAAAA&ccb=7-5&oh=00_AQC_KoewZNx8Q_jUNikl25QBaoJ9vwDjCXPeqK6fkR9hlA&oe=6A68CB06&_nc_sid=7a9f4b',
    videoUrl: 'https://www.instagram.com/stories/highlights/17867189085194624/',
  },
  {
    name: 'davcena85',
    subtitle: '5.844',
    image:
      'https://instagram.fipn8-1.fna.fbcdn.net/v/t51.82787-19/684899680_18585635263017768_995131398238048089_n.jpg?stp=dst-jpg_s150x150_tt6&efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLmRqYW5nby4xMDgwLmMyIn0&_nc_ht=instagram.fipn8-1.fna.fbcdn.net&_nc_cat=100&_nc_oc=Q6cZ2gHH57uisfGwkHkWuq9rZEdT5G9NvLcln_EvEuVSkmkK-UggYuW2zCGhfw0jHVN-YII&_nc_ohc=ylXpaE5UAO8Q7kNvwEf7RK9&_nc_gid=XT4wXxkR53WWWxQxCD4c7A&edm=APoiHPcBAAAA&ccb=7-5&oh=00_AQDyirpMWvzTrU5QFX0b5SB5nKsRQHvTswlyVJi5xC1Ppg&oe=6A68E48F&_nc_sid=22de04',
    videoUrl: 'https://www.instagram.com/stories/highlights/17867189085194624/',
  },
  {
    name: 'vitumc081',
    subtitle: '56,5 mil',
    image:
      'https://instagram.fipn8-1.fna.fbcdn.net/v/t51.82787-19/582081651_18537476581052822_2600229463532947781_n.jpg?stp=dst-jpg_s150x150_tt6&efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLmRqYW5nby4xMDgwLmMyIn0&_nc_ht=instagram.fipn8-1.fna.fbcdn.net&_nc_cat=102&_nc_oc=Q6cZ2gEfgrphmApv3BsyIDgqgLZufrWNeqt94A7027rfMRSexasd3qwcJfVmBTW_Xm_1Pes&_nc_ohc=Fi2AeXGsdkcQ7kNvwFP20-a&_nc_gid=3YoL86rDPiWqxaP9JjFTXA&edm=APoiHPcBAAAA&ccb=7-5&oh=00_AQCct6-u3UDSNZzARg7h33jBmK0eXLZ55SaXijYWtZ3LRw&oe=6A68F543&_nc_sid=22de04',
    videoUrl: 'https://www.instagram.com/stories/highlights/17867189085194624/',
  },
  {
    name: 'mcnoventa',
    subtitle: '381 mil',
    image:
      'https://instagram.fipn8-1.fna.fbcdn.net/v/t51.2885-19/403987298_277243935275187_6766383666695550360_n.jpg?stp=dst-jpg_s150x150_tt6&efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLmRqYW5nby42MDcuYzIifQ&_nc_ht=instagram.fipn8-1.fna.fbcdn.net&_nc_cat=103&_nc_oc=Q6cZ2gH5il9VDfMM_onoeSCU8Q3yH8cIS0EpyMEpR2wtkDsLiuFB8xpecOkxo6tWecMFOiY&_nc_ohc=2tQ-yN0lK1MQ7kNvwHVQiMq&_nc_gid=Msl4FQm8PAZpZg0_adluSw&edm=AP4sbd4BAAAA&ccb=7-5&oh=00_AQBueQbraVTDxi0H1754OWl2p2GFWweMaz3sBg7fgNlp0Q&oe=6A68EF70&_nc_sid=7a9f4b',
    videoUrl: 'https://www.instagram.com/stories/highlights/17867189085194624/',
  },
  {
    name: 'lucaoaldeia',
    subtitle: '11,7 mil',
    image:
      'https://instagram.fipn8-1.fna.fbcdn.net/v/t51.82787-19/565020518_18532867441006306_2673201119566497791_n.jpg?stp=dst-jpg_s150x150_tt6&efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLmRqYW5nby4xMDgwLmMyIn0&_nc_ht=instagram.fipn8-1.fna.fbcdn.net&_nc_cat=110&_nc_oc=Q6cZ2gHN-Umg16lIbS3PuLM-sx4FaIbEAWK2oScIbHVtz2h2UFzMVmPeOIr2T9Z7joKoWxI&_nc_ohc=EelrLWtP6rQQ7kNvwGq3SGA&_nc_gid=-gk5G1m5UpQ4jUuliJwDHg&edm=APoiHPcBAAAA&ccb=7-5&oh=00_AQDfsh3tsq2hO1PEivJzrBbjw83RPQuzj00UDPToY83_7g&oe=6A68E445&_nc_sid=22de04',
    videoUrl: 'https://www.instagram.com/stories/highlights/17867189085194624/',
  },
  {
    name: 'viniciusznmc',
    subtitle: '34,1 mil',
    image:
      'https://instagram.fipn8-1.fna.fbcdn.net/v/t51.82787-19/706237504_18561862933071090_6651647504853444402_n.jpg?stp=dst-jpg_s150x150_tt6&efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLmRqYW5nby4xMDgwLmMyIn0&_nc_ht=instagram.fipn8-1.fna.fbcdn.net&_nc_cat=106&_nc_oc=Q6cZ2gHxmKCcMgwD5x7TSktxZy9L9viIjRH52HVHWfUQp28OQvBc0ZdUJiwF8752VhHXsaE&_nc_ohc=baqmKBZhDsIQ7kNvwHqVdCd&_nc_gid=xKcJzKEv_i748X0onJIMzA&edm=APoiHPcBAAAA&ccb=7-5&oh=00_AQA8RL2gJ0GnpiLpBsSS7F4CY63z9yIdcJeprfyMbd23_A&oe=6A68D10A&_nc_sid=22de04',
    videoUrl: 'https://www.instagram.com/stories/highlights/17867189085194624/',
  },
  {
    name: 'younguimc',
    subtitle: '80,8 mil',
    image:
      'https://instagram.fipn8-1.fna.fbcdn.net/v/t51.82787-19/730713357_18366265492240421_5721127481142638476_n.jpg?stp=dst-jpg_s150x150_tt6&efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLmRqYW5nby4xMDgwLmMyIn0&_nc_ht=instagram.fipn8-1.fna.fbcdn.net&_nc_cat=105&_nc_oc=Q6cZ2gHNQMpyzjEWd2IdDjEpVp_c1LC6SgXiZJJ5LCVzGLlMLEtTv9Y4rUpYSm33j1h6xY4&_nc_ohc=3K2eECLHKk8Q7kNvwHGq-io&_nc_gid=QfiViO6Ck0jT6SJ_ugMJpw&edm=APoiHPcBAAAA&ccb=7-5&oh=00_AQBuI8tX98wjCCq_zI3Yfw1JuyQz_twPNgf9bP-Tq_KS-g&oe=6A68F4AA&_nc_sid=22de04',
    videoUrl: 'https://www.instagram.com/stories/highlights/17867189085194624/',
  },
  {
    name: 'magrao.97',
    subtitle: '800 mil',
    image:
      'https://instagram.fipn8-1.fna.fbcdn.net/v/t51.82787-19/729519988_18382926280206882_2764642890887884339_n.jpg?stp=dst-jpg_s150x150_tt6&efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLmRqYW5nby4xMDgwLmMyIn0&_nc_ht=instagram.fipn8-1.fna.fbcdn.net&_nc_cat=106&_nc_oc=Q6cZ2gFaRWCNrmHbLXRz76EyVMbcsRtQpfLeiU-LrwJeOW6eHo9RhkEsWP3p-p39BcoQ_98&_nc_ohc=762mwY6wAjsQ7kNvwGAZtWZ&_nc_gid=kyexljLRO5IoBAOdA9V-kA&edm=APoiHPcBAAAA&ccb=7-5&oh=00_AQDKkPxSoil3GnUU_-HYWt1to6f_lJJvmSWLeKSKX2HTYg&oe=6A68C672&_nc_sid=22de04',
    videoUrl: 'https://www.instagram.com/stories/highlights/17867189085194624/',
  },
  {
    name: 'thomi3llo',
    subtitle: '1.783',
    image:
      'https://instagram.fipn8-1.fna.fbcdn.net/v/t51.2885-19/500308167_18463816189074452_7887177193707010877_n.jpg?stp=dst-jpg_s150x150_tt6&efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLmRqYW5nby4xMDgwLmV4cGVyaW1lbnRhbCJ9&_nc_ht=instagram.fipn8-1.fna.fbcdn.net&_nc_cat=108&_nc_oc=Q6cZ2gEmCpIbv1B6BHd9TWYHxDCS_C--e5K-cZR90bFX3zt4_JcpY63LRdvJFhywLQyN-YE&_nc_ohc=fr4X23XVJRMQ7kNvwFT_KmW&_nc_gid=YzP1GiIuWs6-HoZwp88U7Q&edm=APoiHPcBAAAA&ccb=7-5&oh=00_AQBprYp1ERvD79OCzmwQEABcQHxodTJyRexotIxekIRQyg&oe=6A68C395&_nc_sid=22de04',
    videoUrl: 'https://www.instagram.com/stories/highlights/17867189085194624/',
  },
  {
    name: 'tibaa_a',
    subtitle: '1.767',
    image:
      'https://instagram.fipn8-1.fna.fbcdn.net/v/t51.2885-19/496811118_18502307089018003_4896901450965284343_n.jpg?stp=dst-jpg_s150x150_tt6&efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLmRqYW5nby4xMDgwLmMyIn0&_nc_ht=instagram.fipn8-1.fna.fbcdn.net&_nc_cat=107&_nc_oc=Q6cZ2gGZw5UwXnO43j9xYmVmDSHfc8hnGlkzv6izkE7tIqZKxCb3J44Td_wFoyvUpdhs9OU&_nc_ohc=1krtPFnVHV0Q7kNvwH39wO7&_nc_gid=7RxZ8V60EEaqVn3NDofBtg&edm=APoiHPcBAAAA&ccb=7-5&oh=00_AQA_DqBcr0zt8cyps6tL2AQU-AFwDmoH35liy1IFdDY_3A&oe=6A68E8B6&_nc_sid=22de04',
    videoUrl: 'https://www.instagram.com/stories/highlights/17867189085194624/',
  },
  {
    name: 'pradodazn',
    subtitle: '264 mil',
    image:
      'https://instagram.fipn8-1.fna.fbcdn.net/v/t51.82787-19/529303190_18337755016203387_4684603791156961956_n.jpg?stp=dst-jpg_s150x150_tt6&efg=eyJ2ZW5jb2RlX3RhZyI6InByb2ZpbGVfcGljLmRqYW5nby4xMDgwLmMyIn0&_nc_ht=instagram.fipn8-1.fna.fbcdn.net&_nc_cat=103&_nc_oc=Q6cZ2gE6rNhTlTBHVEK_R5AwwQgshpRjUZTkqNyhRGvOFNzFKzdtzE633qv_nvgSMiCzcms&_nc_ohc=6SRtiZCqDEYQ7kNvwH954XL&_nc_gid=CI5AJAyY_4F9yT3TyvH2Lg&edm=APoiHPcBAAAA&ccb=7-5&oh=00_AQAMo30Pk5DAF7pxxBiCDKo-LRbEUElm5FvLLlhxyc2fGw&oe=6A68D457&_nc_sid=22de04',
    videoUrl: 'https://www.instagram.com/stories/highlights/17867189085194624/',
  },
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(
      url,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
          Referer: 'https://www.instagram.com/',
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlink(dest, () => {});
          return download(res.headers.location, dest).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(dest)));
      }
    );
    req.on('error', (err) => {
      file.close();
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const rows = [];
  for (let i = 0; i < clients.length; i++) {
    const c = clients[i];
    const safe = c.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${safe}.jpg`;
    const dest = path.join(outDir, filename);
    let avatarUrl = c.image;

    try {
      await download(c.image, dest);
      const size = fs.statSync(dest).size;
      if (size > 1000) {
        avatarUrl = `/famous-clients/${filename}`;
        console.log('OK download', c.name, size);
      } else {
        console.log('WARN small file, using remote', c.name, size);
      }
    } catch (e) {
      console.log('WARN download failed, using remote URL', c.name, e.message);
    }

    rows.push({
      name: c.name,
      subtitle: c.subtitle,
      avatarUrl,
      videoUrl: c.videoUrl,
      sortOrder: i,
      isActive: true,
    });
  }

  await prisma.famousClient.deleteMany({});
  await prisma.famousClient.createMany({ data: rows });
  const count = await prisma.famousClient.count();
  console.log('Imported', count, 'famous clients');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
