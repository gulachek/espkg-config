set path=,,src/**,test/**

" build
nnoremap <Leader>b :!npx tsc<CR>

" test
nnoremap <Leader>t :!npm run test<CR>
nnoremap <Leader>c :!npm run coverage; open coverage/index.html<CR>
