
cd backend
touch prepare_db.sqlite
prepare_db_path=$(realpath prepare_db.sqlite)
DATABASE_URL=sqlite:$prepare_db_path cargo sqlx migrate run
DATABASE_URL=sqlite:$prepare_db_path cargo sqlx prepare
rm prepare_db.sqlite