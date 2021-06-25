#pragma once

#include <eosiolib/asset.hpp>
#include <eosiolib/eosio.hpp>
#include <eosiolib/singleton.hpp>
#include <eosiolib/system.hpp>
#include <eosiolib/time.hpp>

namespace eosio {

   static constexpr eosio::name oracle_account    = "eosio"_n;
   static_assert(oracle_account, "oracle_account is empty. Please provide valid oracle account name");

   static constexpr eosio::name active_permission = "active"_n;
   static constexpr eosio::name request_action    = "addrequest"_n;
   static constexpr eosio::name reply_action      = "reply"_n;

   class [[eosio::contract]] client : public contract {

   private:
      struct api {
         std::string endpoint;
         std::string json_field;
      };

      struct [[eosio::table]] btc_balances {
         uint64_t id;
         double amount;

         uint64_t primary_key() const { return id; }
      };
      typedef eosio::multi_index< "btcbalances"_n, btc_balances > btc_balances_table;

      struct [[eosio::table("config")]] configuration {
         uint64_t next_request_id = 0;
      };
      typedef eosio::singleton< "config"_n, configuration > configuration_singleton;

      void make_request( uint64_t request_id, const std::vector<api>& apis, uint16_t response_type, uint16_t aggregation_type, uint16_t prefered_api, std::string string_to_count  );

      configuration_singleton _config_singleton;
      configuration           _config;

   public:
      client( name s, name code, datastream<const char*> ds );
      ~client();

      void reply( const eosio::name& caller, uint64_t request_id, const std::vector<char>& response );

      [[eosio::action]]
      void addreq( const std::vector<api>& apis, uint16_t response_type, uint16_t aggregation_type, uint16_t prefered_api, std::string string_to_count );
   };

} /// namespace eosio
